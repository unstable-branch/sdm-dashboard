#!/usr/bin/env python3
"""Dependency-contract check: every hard R dependency declared in DESCRIPTION must
appear as a record in renv.lock.

Motivation: renv.lock is the R runtime contract for the workbench. A hard import
(Imports / Depends / LinkingTo) that has no lockfile record cannot be restored by
`renv::restore()` on a clean machine, so the declared dependency and the pinned
environment disagree. `renv::status()` reports the reverse direction (packages
used by source that are unrecorded); this check covers the declared contract so a
missing hard import fails deterministically before any restore is attempted.

Deterministic and dependency-free: standard library only, no network, no R, and
it never reads the environment or a project library. Both DESCRIPTION field
layouts are parsed: the inline form (`Imports: a, b`) and the continuation form
(`Imports:` followed by indented lines). A hard-dependency field whose value is
non-empty but yields no dependency name, or a DESCRIPTION that declares no hard
dependency at all, is a hard failure rather than a silent pass. Usage:

    python3 scripts/check_renv_imports.py [DESCRIPTION] [renv.lock]
    python3 scripts/check_renv_imports.py --self-test

Exit status 0 when every non-base hard dependency is recorded in the lockfile;
exit status 1 with the sorted missing names otherwise (and for any parse that
cannot read the declared hard dependencies).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parents[1]

# R base-priority packages: always available, never recorded in a lockfile.
BASE_PACKAGES = frozenset(
    {
        "base",
        "compiler",
        "datasets",
        "graphics",
        "grDevices",
        "grid",
        "methods",
        "parallel",
        "splines",
        "stats",
        "stats4",
        "tcltk",
        "tools",
        "utils",
    }
)

# The R runtime itself may be declared in Depends (e.g. "R (>= 4.3)") but is part
# of the base/runtime environment, not a lockfile record.
BASE_RUNTIME = frozenset({"R"})

# Dependencies in this set are satisfied by the R installation itself and must
# never be required to appear as renv.lock records.
NO_RECORD_REQUIRED = BASE_PACKAGES | BASE_RUNTIME

# Hard dependency fields, in DESCRIPTION order. Suggests is deliberately excluded:
# it is an optional/dev scope, not the restore contract this check pins.
HARD_FIELDS = ("Depends", "Imports", "LinkingTo")

# DCF field header: field names may contain letters, digits, and .@_+- (Authors@R).
FIELD_RE = re.compile(r"^([A-Za-z][A-Za-z0-9.@_+-]*):(.*)$")


class CheckError(Exception):
    """A DESCRIPTION/lockfile contract violation, reported as a non-zero exit."""


def fail(message: str) -> NoReturn:
    raise SystemExit(f"renv import check failed: {message}")


def parse_description(text: str) -> dict[str, list[str]]:
    """Parse DESCRIPTION into {lowercased field name: [value chunks]}.

    Chunks are the inline value plus every indented continuation line, in file
    order. A blank line terminates the current field; a repeated field name is
    rejected rather than silently merged.
    """
    fields: dict[str, list[str]] = {}
    current: str | None = None
    defined: set[str] = set()
    for raw in text.splitlines():
        if not raw.strip():
            current = None
            continue
        if raw[0] in " \t":
            if current is not None:
                fields[current].append(raw.strip())
            continue
        match = FIELD_RE.match(raw)
        if not match:
            current = None
            continue
        name = match.group(1).lower()
        if name in defined:
            raise CheckError(f"duplicate DESCRIPTION field: {match.group(1)}")
        defined.add(name)
        fields[name] = [match.group(2).strip()]
        current = name
    return fields


def read_field(fields: dict[str, list[str]], field: str) -> tuple[bool, str, list[str]]:
    """Return (present, raw value, dependency names) for a DESCRIPTION field.

    Absent field -> (False, "", []). Present field -> its value with version
    constraints ("pkg (>= 1.0)" -> "pkg") reduced to bare dependency names.
    """
    key = field.lower()
    if key not in fields:
        return False, "", []
    raw = " ".join(fields[key]).strip()
    names: list[str] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        name = item.split("(", 1)[0].strip()
        if name:
            names.append(name)
    return True, raw, names


def evaluate(
    description_text: str, recorded: dict
) -> tuple[dict[str, list[str]], list[str]]:
    """Return (declared hard deps, missing names) or raise CheckError."""
    fields = parse_description(description_text)
    declared: dict[str, list[str]] = {}
    saw_hard_field = False
    hard_names = 0
    for field in HARD_FIELDS:
        present, raw, names = read_field(fields, field)
        if not present:
            continue
        saw_hard_field = True
        if raw and not names:
            raise CheckError(
                f"{field} has a non-empty value that parses to zero dependency "
                f"names: {raw!r}"
            )
        hard_names += len(names)
        for name in names:
            if name in NO_RECORD_REQUIRED:
                continue
            declared.setdefault(name, []).append(field)
    if not saw_hard_field or hard_names == 0:
        raise CheckError(
            "no hard dependencies (Depends/Imports/LinkingTo) could be read "
            "from DESCRIPTION"
        )
    missing = sorted(name for name in declared if name not in recorded)
    return declared, missing


# Negative/positive fixtures for the inline-form regression that previously
# produced a vacuous pass. Each entry is
# (label, DESCRIPTION text, recorded packages, ("missing", names) | ("error", None)).
SELF_TEST_FIXTURES = (
    (
        "inline Imports is parsed",
        "Package: T\nImports: definitelyNotInLock\n",
        {"presentPkg": {}},
        ("missing", ["definitelyNotInLock"]),
    ),
    (
        "inline Depends is parsed",
        "Package: T\nDepends: definitelyNotInLock\n",
        {"presentPkg": {}},
        ("missing", ["definitelyNotInLock"]),
    ),
    (
        "continuation form is parsed",
        "Package: T\nImports:\n    definitelyNotInLock,\n    otherPkg\n",
        {"presentPkg": {}},
        ("missing", ["definitelyNotInLock", "otherPkg"]),
    ),
    (
        "base R and base packages are not lockfile records",
        "Package: T\nDepends: R (>= 4.3), methods, utils\n",
        {"presentPkg": {}},
        ("missing", []),
    ),
    (
        "recorded dependency with a version constraint passes",
        "Package: T\nImports: presentPkg (>= 1.0)\n",
        {"presentPkg": {}},
        ("missing", []),
    ),
    (
        "empty-valued inline hard field fails closed",
        "Package: T\nImports: ()\n",
        {"presentPkg": {}},
        ("error", None),
    ),
    (
        "DESCRIPTION with no hard dependency fails closed",
        "Package: T\nTitle: nothing\n",
        {"presentPkg": {}},
        ("error", None),
    ),
)


def run_self_test() -> int:
    problems: list[str] = []
    for label, description, recorded, expected in SELF_TEST_FIXTURES:
        try:
            _declared, missing = evaluate(description, recorded)
            outcome: tuple[str, object] = ("missing", missing)
        except CheckError:
            outcome = ("error", None)
        if expected[0] == "error":
            ok = outcome[0] == "error"
        else:
            ok = outcome[0] == "missing" and outcome[1] == expected[1]
        if not ok:
            problems.append(f"{label}: expected {expected[0]}, got {outcome}")
        print(f"{'ok' if ok else 'FAIL'}: {label}")
    if problems:
        print("renv import self-test failed:")
        for problem in problems:
            print(f"  {problem}")
        return 1
    print(f"renv import self-test passed: {len(SELF_TEST_FIXTURES)} fixtures")
    return 0


def main(argv: list[str]) -> int:
    args = argv[1:]
    if args and args[0] in ("-h", "--help"):
        print((__doc__ or "").strip())
        return 0
    if args and args[0] == "--self-test":
        return run_self_test()
    if len(args) > 2:
        fail("usage: check_renv_imports.py [DESCRIPTION] [renv.lock] | --self-test")
    description_path = Path(args[0]) if len(args) > 0 else ROOT / "DESCRIPTION"
    lockfile_path = Path(args[1]) if len(args) > 1 else ROOT / "renv.lock"
    if not description_path.is_file():
        fail(f"DESCRIPTION not found: {description_path}")
    if not lockfile_path.is_file():
        fail(f"lockfile not found: {lockfile_path}")

    description = description_path.read_text(encoding="utf-8")
    lock = json.loads(lockfile_path.read_text(encoding="utf-8"))
    recorded = lock.get("Packages")
    if not isinstance(recorded, dict) or not recorded:
        fail(f"{lockfile_path} has no Packages records")

    try:
        declared, missing = evaluate(description, recorded)
    except CheckError as exc:
        fail(str(exc))

    print(
        f"declared hard deps: {len(declared)}, lockfile records: {len(recorded)}, "
        f"missing: {len(missing)}"
    )
    for name in missing:
        print(f"missing from lockfile: {name} (declared in {', '.join(declared[name])})")
    if missing:
        print(
            "renv import check failed: "
            + ", ".join(missing)
            + " are declared hard dependencies with no renv.lock record"
        )
        return 1
    print("renv import check passed: every declared hard dependency is recorded")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
