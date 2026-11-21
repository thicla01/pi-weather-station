#!/usr/bin/env python3
"""Read-only integrity check of a kiosk's localStorage (Chromium's leveldb).

Every per-device preference of the kiosk (units, clock, palette, brightness
keys, starting zoom, ...) lives in the browser's localStorage, a leveldb
directory in the browser profile. A power cut can tear its write-ahead log.
Chromium then replays the log only up to the tear at every start and drops
every write made after it: settings changed on the screen "come back" after a
relaunch (ROADMAP, "Kiosk preferences in Chromium's localStorage don't survive
a power cut"). This tool tells whether that happened, without touching the Pi.

Usage (maintainer tool; nothing here runs on a Pi by itself):

    # on a kiosk, over SSH -- the script travels on stdin, nothing is written:
    ssh pi@<ip> python3 - < tools/check-kiosk-localstorage.py
    ssh pi@<ip> python3 - --all < tools/check-kiosk-localstorage.py

    # on a copied leveldb directory:
    python3 tools/check-kiosk-localstorage.py --dir <path-to-leveldb>

    # the parser's own tests (no kiosk needed):
    python3 tools/check-kiosk-localstorage.py --selftest

What it checks, for each Chromium-family profile it finds:
  - *.log (the write-ahead log): every record's checksum and length. The first
    bad one is the tear; it prints how much lies after it, and the localStorage
    writes found before and after (the ones after are the lost settings).
  - *.ldb (the tables): footer, checksum of the index block and of every data
    block (snappy decompressed in pure Python). --all lists what they hold.
  - MANIFEST-*: every record's checksum.
  - LOG / LOG.old (leveldb's own notes): any "dropping" or "Corruption" line.

Exit status: 0 no damage found, 1 damage found, 2 no leveldb directory found.

Limits: Chromium-family browsers only (Firefox keeps localStorage in SQLite).
A clean result means the files are consistent; a power cut can still have lost
the last writes Chromium had not flushed yet (it defers them up to a minute).
The live page stays the ground truth for the values in effect.
"""
import glob
import os
import struct
import sys
import tempfile
import time

# Same profile directories as kiosk_profile_dir() in deploy/relaunch-kiosk.sh.
PROFILE_DIRS = (
    ".config/chromium",
    ".config/google-chrome",
    ".config/microsoft-edge",
    ".config/BraveSoftware/Brave-Browser",
)
LEVELDB_SUBDIR = os.path.join("Default", "Local Storage", "leveldb")

BLOCK = 32768                                   # leveldb log block size
TABLE_MAGIC = bytes.fromhex("57fb808b247547db")  # kTableMagicNumber, little-endian
LAST_WRITES_SHOWN = 14

_CRC_TABLE = []
for _i in range(256):
    _c = _i
    for _ in range(8):
        _c = (_c >> 1) ^ 0x82F63B78 if _c & 1 else _c >> 1
    _CRC_TABLE.append(_c)


def crc32c(data):
    """CRC-32C (Castagnoli), the checksum leveldb uses."""
    crc = 0xFFFFFFFF
    for byte in data:
        crc = _CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >> 8)
    return crc ^ 0xFFFFFFFF


def masked(crc):
    """leveldb stores checksums masked (rotated and offset)."""
    return (((crc >> 15) | (crc << 17)) + 0xA282EAD8) & 0xFFFFFFFF


def varint(buf, pos):
    """Decode one varint at `pos`; returns (value, next position)."""
    shift = 0
    out = 0
    while True:
        byte = buf[pos]
        pos += 1
        out |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return out, pos
        shift += 7


def snappy_decompress(buf):
    """Raw snappy block format, enough for leveldb's table blocks."""
    want, pos = varint(buf, 0)
    out = bytearray()
    while pos < len(buf):
        tag = buf[pos]
        pos += 1
        kind = tag & 3
        if kind == 0:                            # literal
            length = tag >> 2
            if length >= 60:
                extra = length - 59
                length = int.from_bytes(buf[pos:pos + extra], "little")
                pos += extra
            length += 1
            out += buf[pos:pos + length]
            pos += length
            continue
        if kind == 1:                            # copy, 1-byte offset
            length = ((tag >> 2) & 7) + 4
            offset = ((tag >> 5) << 8) | buf[pos]
            pos += 1
        elif kind == 2:                          # copy, 2-byte offset
            length = (tag >> 2) + 1
            offset = int.from_bytes(buf[pos:pos + 2], "little")
            pos += 2
        else:                                    # copy, 4-byte offset
            length = (tag >> 2) + 1
            offset = int.from_bytes(buf[pos:pos + 4], "little")
            pos += 4
        if offset == 0 or offset > len(out):
            raise ValueError("snappy copy offset %d out of range" % offset)
        for _ in range(length):
            out.append(out[-offset])
    if len(out) != want:
        raise ValueError("snappy length %d, expected %d" % (len(out), want))
    return bytes(out)


def dom_text(raw):
    """A Chromium DOM-storage string: first byte 0 = UTF-16LE, 1 = Latin-1."""
    if not raw:
        return ""
    if raw[0] == 0:
        return raw[1:].decode("utf-16-le", "replace")
    if raw[0] == 1:
        return raw[1:].decode("latin-1", "replace")
    return raw.decode("latin-1", "replace")


def key_name(key):
    """The localStorage key of a leveldb key (`_<origin>\\0<key>`), else the raw key."""
    if key.startswith(b"_"):
        _, _, rest = key[1:].partition(b"\x00")
        return dom_text(rest)
    return key.decode("latin-1", "replace")


def is_noise(name):
    """Bookkeeping rows nobody set by hand."""
    return name.startswith("META") or name.startswith("VERSION") or name.startswith("i18next.translate")


def decode_batches(payloads):
    """leveldb WriteBatches -> [(file offset, sequence, [(op, key, value)])]."""
    out = []
    for offset, payload in payloads:
        try:
            seq, count = struct.unpack_from("<QI", payload, 0)
            pos = 12
            ops = []
            for _ in range(count):
                tag = payload[pos]
                pos += 1
                klen, pos = varint(payload, pos)
                key = payload[pos:pos + klen]
                pos += klen
                value = b""
                if tag == 1:
                    vlen, pos = varint(payload, pos)
                    value = payload[pos:pos + vlen]
                    pos += vlen
                ops.append(("put" if tag == 1 else "del", key_name(key), dom_text(value)))
            out.append((offset, seq, ops))
        except (IndexError, struct.error) as exc:
            out.append((offset, -1, [("???", "undecodable batch: %s" % exc, "")]))
    return out


def scan_log(data, decode=True):
    """Walk a leveldb log-format file (a *.log or a MANIFEST) record by record.

    Returns a dict: size, good (valid physical records), first_bad (offset of
    the first bad record, or None), reasons [(offset, why)], before / after
    (decoded batches found before / after the first bad record).
    """
    size = len(data)
    off = 0
    good = 0
    first_bad = None
    reasons = []
    before, after = [], []
    pending = None
    while off < size:
        left = BLOCK - (off % BLOCK)
        if left < 7:                             # block trailer
            off += left
            continue
        if off + 7 > size:
            reasons.append((off, "header cut by the end of the file"))
            first_bad = off if first_bad is None else first_bad
            break
        stored, length, kind = struct.unpack_from("<IHB", data, off)
        if stored == 0 and length == 0 and kind == 0:
            off += left                          # zero padding up to the next block
            continue
        end = off + 7 + length
        why = None
        if length > left - 7:
            why = "length runs past its block"
        elif end > size:
            why = "payload cut by the end of the file"
        elif kind not in (1, 2, 3, 4):
            why = "unknown record type %d" % kind
        elif masked(crc32c(data[off + 6:end])) != stored:
            why = "checksum mismatch"
        if why:
            reasons.append((off, why))
            if first_bad is None:
                first_bad = off
            pending = None
            off += left                          # leveldb drops the rest of the block
            continue
        good += 1
        payload = data[off + 7:end]
        bucket = before if first_bad is None else after
        if kind == 1:                            # FULL
            bucket.append((off, payload))
        elif kind == 2:                          # FIRST
            pending = (off, bytearray(payload))
        elif pending is not None:                # MIDDLE or LAST
            pending[1].extend(payload)
            if kind == 4:
                bucket.append((pending[0], bytes(pending[1])))
                pending = None
        off = end
    return {
        "size": size,
        "good": good,
        "first_bad": first_bad,
        "reasons": reasons,
        "before": decode_batches(before) if decode else before,
        "after": decode_batches(after) if decode else after,
    }


def read_block(data, off, size):
    """One table block: (contents, checksum ok?)."""
    kind = data[off + size]
    stored = struct.unpack_from("<I", data, off + size + 1)[0]
    ok = masked(crc32c(data[off:off + size + 1])) == stored
    raw = data[off:off + size]
    return (snappy_decompress(raw) if kind == 1 else raw), ok


def block_entries(block):
    """(key, value) pairs of a table block (prefix-compressed keys)."""
    restarts = struct.unpack_from("<I", block, len(block) - 4)[0]
    end = len(block) - 4 - 4 * restarts
    pos = 0
    key = b""
    while pos < end:
        shared, pos = varint(block, pos)
        fresh, pos = varint(block, pos)
        vlen, pos = varint(block, pos)
        key = key[:shared] + block[pos:pos + fresh]
        pos += fresh
        yield key, block[pos:pos + vlen]
        pos += vlen


def read_table(data):
    """Check a *.ldb table. Returns a dict: magic_ok, index_ok, good / bad
    (data blocks), rows [(sequence, key name, value or '<deleted>')]."""
    result = {"size": len(data), "magic_ok": data[-8:] == TABLE_MAGIC, "index_ok": False,
              "good": 0, "bad": 0, "rows": []}
    if not result["magic_ok"] or len(data) < 48:
        return result
    footer = data[-48:]
    _, pos = varint(footer, 0)                   # metaindex handle (unused)
    _, pos = varint(footer, pos)
    index_off, pos = varint(footer, pos)
    index_size, pos = varint(footer, pos)
    try:
        index, result["index_ok"] = read_block(data, index_off, index_size)
        handles = [value for _, value in block_entries(index)]
    except (IndexError, ValueError, struct.error):
        return result
    for handle in handles:
        off, pos = varint(handle, 0)
        size, pos = varint(handle, pos)
        try:
            block, ok = read_block(data, off, size)
            rows = []
            for ikey, value in block_entries(block):
                trailer = int.from_bytes(ikey[-8:], "little")
                rows.append((trailer >> 8, key_name(ikey[:-8]),
                             dom_text(value) if trailer & 0xFF else "<deleted>"))
        except (IndexError, ValueError, struct.error):
            ok, rows = False, []
        result["good" if ok else "bad"] += 1
        result["rows"].extend(rows)
    return result


def describe(ops, limit=70):
    """One line for a batch's writes, bookkeeping rows left out."""
    parts = []
    for op, name, value in ops:
        if is_noise(name):
            continue
        parts.append("put %s=%s" % (name, value[:limit]) if op == "put" else "%s %s" % (op, name))
    return "; ".join(parts)


def print_batches(batches, show_all):
    shown = batches if show_all else batches[-LAST_WRITES_SHOWN:]
    for offset, seq, ops in shown:
        line = describe(ops)
        if line:
            print("     seq %-6d @%-6d %s" % (seq, offset, line[:230]))


def report(directory, show_all=False):
    """Print the check of one leveldb directory; returns the damaged file names."""
    damaged = []
    print("== %s ==" % directory)
    for name in sorted(os.listdir(directory)):
        stat = os.stat(os.path.join(directory, name))
        print("   %-18s %8d bytes  %s" % (
            name, stat.st_size, time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime))))

    for path in sorted(glob.glob(os.path.join(directory, "*.log"))):
        name = os.path.basename(path)
        with open(path, "rb") as handle:
            log = scan_log(handle.read())
        if log["first_bad"] is None:
            print("\n   %s: clean, %d valid records, no torn record" % (name, log["good"]))
        else:
            damaged.append(name)
            print("\n   %s: TORN at offset %d (%s); %d bytes lie after it, %d bad spot(s)" % (
                name, log["first_bad"], log["reasons"][0][1],
                log["size"] - log["first_bad"], len(log["reasons"])))
            for offset, why in log["reasons"][:6]:
                print("     bad @%d: %s" % (offset, why))
        seqs = [seq for _, seq, _ in log["before"] if seq >= 0]
        print("   %s: %d batches (sequence %s to %s)%s" % (
            "writes in the log" if log["first_bad"] is None else "writes before the tear",
            len(log["before"]), seqs[0] if seqs else "-", seqs[-1] if seqs else "-",
            "" if show_all else ", last %d shown" % LAST_WRITES_SHOWN))
        print_batches(log["before"], show_all)
        if log["after"]:
            seqs = [seq for _, seq, _ in log["after"] if seq >= 0]
            print("   writes AFTER the tear, dropped at every browser start: %d batches (sequence %s to %s)" % (
                len(log["after"]), seqs[0] if seqs else "-", seqs[-1] if seqs else "-"))
            print_batches(log["after"], True)

    for path in sorted(glob.glob(os.path.join(directory, "*.ldb"))):
        name = os.path.basename(path)
        with open(path, "rb") as handle:
            table = read_table(handle.read())
        ok = table["magic_ok"] and table["index_ok"] and table["bad"] == 0
        if not ok:
            damaged.append(name)
        print("\n   %s: %s -- footer %s, index %s, data blocks ok=%d bad=%d, %d entries" % (
            name, "clean" if ok else "DAMAGED",
            "ok" if table["magic_ok"] else "BAD", "ok" if table["index_ok"] else "BAD",
            table["good"], table["bad"], len(table["rows"])))
        if show_all:
            for seq, key, value in table["rows"]:
                if not is_noise(key):
                    print("     seq %-6d %s = %s" % (seq, key[:44], value[:70]))

    for path in sorted(glob.glob(os.path.join(directory, "MANIFEST-*"))):
        name = os.path.basename(path)
        with open(path, "rb") as handle:
            manifest = scan_log(handle.read(), decode=False)
        if manifest["first_bad"] is not None:
            damaged.append(name)
        print("\n   %s: %s, %d valid records, %d bad" % (
            name, "clean" if manifest["first_bad"] is None else "DAMAGED",
            manifest["good"], len(manifest["reasons"])))

    for name in ("LOG.old", "LOG"):
        path = os.path.join(directory, name)
        if not os.path.exists(path):
            continue
        with open(path, errors="replace") as handle:
            lines = handle.read().splitlines()
        alarms = [line for line in lines if "dropping" in line or "orruption" in line]
        print("\n   %s: %d lines, %d mention dropped or corrupt data" % (name, len(lines), len(alarms)))
        for line in (alarms or lines)[-4:]:
            print("     " + line[:170])
        if alarms:
            damaged.append(name)

    return damaged


# --------------------------------------------------------------------------
# Self-test: hand-made files, so the parser is checked without a kiosk.
# --------------------------------------------------------------------------

def _record(payload, kind=1):
    return struct.pack("<IHB", masked(crc32c(bytes([kind]) + payload)), len(payload), kind) + payload


def _batch(seq, key, value):
    full_key = b"_https://localhost:8443\x00\x01" + key.encode()
    full_value = b"\x01" + value.encode()
    return (struct.pack("<QI", seq, 1) + b"\x01" + bytes([len(full_key)]) + full_key
            + bytes([len(full_value)]) + full_value)


def _varint(value):
    out = bytearray()
    while True:
        out.append((value & 0x7F) | (0x80 if value > 0x7F else 0))
        value >>= 7
        if not value:
            return bytes(out)


def _snappy_literals(raw):
    """A valid snappy stream made of literals only (no compression)."""
    out = bytearray(_varint(len(raw)))
    for start in range(0, len(raw), 60):
        chunk = raw[start:start + 60]
        out.append((len(chunk) - 1) << 2)
        out += chunk
    return bytes(out)


def _block(pairs):
    body = bytearray()
    for key, value in pairs:
        body += _varint(0) + _varint(len(key)) + _varint(len(value)) + key + value
    return bytes(body) + struct.pack("<II", 0, 1)


def _table(blocks):
    """A minimal table: `blocks` is [(pairs, compressed?)]."""
    out = bytearray()
    handles = []

    def put(contents, compressed):
        """Append one block; returns its handle (offset and size as varints)."""
        stored = _snappy_literals(contents) if compressed else contents
        kind = 1 if compressed else 0
        handle = _varint(len(out)) + _varint(len(stored))
        out.extend(stored + bytes([kind])
                   + struct.pack("<I", masked(crc32c(stored + bytes([kind])))))
        return handle

    for pairs, compressed in blocks:
        handles.append((pairs[-1][0], put(_block(pairs), compressed)))
    footer = put(_block([]), False) + put(_block(handles), False)
    return bytes(out) + footer.ljust(40, b"\x00") + TABLE_MAGIC


def _ikey(name, seq, live=True):
    return b"_https://localhost:8443\x00\x01" + name.encode() + ((seq << 8) | (1 if live else 0)).to_bytes(8, "little")


def selftest():
    assert crc32c(b"123456789") == 0xE3069283, "CRC-32C check value"
    assert snappy_decompress(bytes([8, 0x0C]) + b"abcd" + bytes([0x01, 0x04])) == b"abcdabcd", "snappy copy"
    long_text = bytes(range(256)) * 2
    assert snappy_decompress(_snappy_literals(long_text)) == long_text, "snappy literals"

    records = [_record(_batch(100 + i, "key%d" % i, "value%d" % i)) for i in range(6)]
    clean = b"".join(records)
    log = scan_log(clean)
    assert log["first_bad"] is None and log["good"] == 6, "clean log"
    assert [seq for _, seq, _ in log["before"]] == [100, 101, 102, 103, 104, 105]
    assert log["before"][2][2] == [("put", "key2", "value2")]

    torn = bytearray(clean)
    tear = len(b"".join(records[:3]))
    torn[tear + 10] ^= 0xFF
    log = scan_log(bytes(torn))
    assert log["first_bad"] == tear and log["reasons"][0][1] == "checksum mismatch", "torn log"
    assert [seq for _, seq, _ in log["before"]] == [100, 101, 102]

    # A tear in the first block must not hide valid records in the next one.
    padded = bytes(torn) + b"\x00" * (BLOCK - len(torn)) + _record(_batch(200, "late", "lost"))
    log = scan_log(padded)
    assert log["first_bad"] == tear
    assert log["after"] and log["after"][0][1] == 200 and log["after"][0][2] == [("put", "late", "lost")]

    # A record split over FIRST / MIDDLE / LAST fragments.
    payload = _batch(300, "split", "x" * 40)
    parts = _record(payload[:20], 2) + _record(payload[20:40], 3) + _record(payload[40:], 4)
    log = scan_log(parts)
    assert log["first_bad"] is None and log["before"][0][2] == [("put", "split", "x" * 40)]
    assert scan_log(clean[:-5])["reasons"][0][1] == "payload cut by the end of the file"

    table_bytes = _table([
        ([(_ikey("clockTime", 7), b"\x0124"), (_ikey("tempUnit", 9), b"\x01c")], False),
        ([(_ikey("oldKey", 11, live=False), b""), (_ikey("speedUnit", 12), b"\x01kmh")], True),
    ])
    table = read_table(table_bytes)
    assert table["magic_ok"] and table["index_ok"] and (table["good"], table["bad"]) == (2, 0), table
    assert table["rows"] == [(7, "clockTime", "24"), (9, "tempUnit", "c"),
                             (11, "oldKey", "<deleted>"), (12, "speedUnit", "kmh")], table["rows"]
    damaged_table = bytearray(table_bytes)
    damaged_table[5] ^= 0xFF
    table = read_table(bytes(damaged_table))
    assert (table["good"], table["bad"]) == (1, 1), "a flipped byte must fail one data block"
    assert not read_table(table_bytes[:-1] + b"\x00")["magic_ok"], "footer magic"

    with tempfile.TemporaryDirectory() as directory:
        for name, blob in (("000003.log", clean), ("000005.ldb", table_bytes),
                           ("MANIFEST-000001", _record(b"edit"))):
            with open(os.path.join(directory, name), "wb") as handle:
                handle.write(blob)
        with open(os.devnull, "w") as quiet:
            stdout, sys.stdout = sys.stdout, quiet
            try:
                assert report(directory) == [], "a clean directory reports nothing"
                with open(os.path.join(directory, "000003.log"), "wb") as handle:
                    handle.write(bytes(torn))
                with open(os.path.join(directory, "LOG"), "w") as handle:
                    handle.write("2026/01/01 000003.log: dropping 64 bytes; Corruption: checksum mismatch\n")
                assert report(directory, show_all=True) == ["000003.log", "LOG"], "damage is named"
            finally:
                sys.stdout = stdout
    print("selftest: ok")


def main(argv):
    if "--selftest" in argv:
        selftest()
        return 0
    show_all = "--all" in argv
    if "--dir" in argv:
        directories = [argv[argv.index("--dir") + 1]]
    else:
        home = os.path.expanduser("~")
        directories = [os.path.join(home, profile, LEVELDB_SUBDIR) for profile in PROFILE_DIRS]
    directories = [d for d in directories if os.path.isdir(d)]
    if not directories:
        print("No Chromium-family Local Storage directory found (use --dir <path>).")
        return 2
    print("host: %s | %s" % (os.uname().nodename, time.strftime("%Y-%m-%d %H:%M")))
    damaged = []
    for directory in directories:
        damaged += ["%s/%s" % (directory, name) for name in report(directory, show_all)]
        print()
    if damaged:
        print("RESULT: DAMAGE FOUND in " + ", ".join(damaged))
        return 1
    print("RESULT: no damage found")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
