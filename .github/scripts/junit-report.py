#!/usr/bin/env python3
"""CI helper: print the JUnit results as annotations.

Green says nothing about how many tests ran, and a red job says nothing about which assertion
failed, because Gradle's console output is not always reachable. The test XML has both facts.
"""
import glob
import sys
import xml.etree.ElementTree as ET


def main() -> int:
    total = failed = skipped = 0
    for path in glob.glob("**/build/test-results/**/*.xml", recursive=True):
        try:
            suites = ET.parse(path).getroot()
        except ET.ParseError:
            continue
        for case in suites.iter("testcase"):
            if case.find("skipped") is not None:
                skipped += 1
                continue
            total += 1
            for failure in case.findall("failure") + case.findall("error"):
                failed += 1
                message = (failure.get("message") or "").strip().replace("\n", " ")
                print(f"::error::{case.get('classname')}.{case.get('name')} -> {message[:400]}")
    print(f"::notice::JVM tests executed: {total}, failures: {failed}, skipped: {skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
