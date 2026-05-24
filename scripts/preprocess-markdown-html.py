import sys
from pathlib import Path

from bs4 import BeautifulSoup


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: preprocess-markdown-html.py input.html output.html", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    soup = BeautifulSoup(input_path.read_text(encoding="utf-8"), "html.parser")

    for display in list(soup.select(".katex-display")):
        annotation = display.find("annotation", attrs={"encoding": "application/x-tex"})
        if annotation is None:
            continue

        tex = annotation.get_text(strip=False).strip()
        if not tex:
            continue

        replacement = soup.new_tag("div")
        replacement["class"] = [
            "braiser-markdown-math",
            "braiser-markdown-math-display",
        ]
        replacement["data-braiser-source"] = "katex"
        replacement.string = f"$$\n{tex}\n$$"
        display.replace_with(replacement)

    for katex in list(soup.select(".katex")):
        if katex.parent is None or katex.find_parent(class_="katex-display") is not None:
            continue

        annotation = katex.find("annotation", attrs={"encoding": "application/x-tex"})
        if annotation is None:
            continue

        tex = annotation.get_text(strip=False).strip()
        if not tex:
            continue

        replacement = soup.new_tag("span")
        replacement["class"] = [
            "braiser-markdown-math",
            "braiser-markdown-math-inline",
        ]
        replacement["data-braiser-source"] = "katex"
        replacement.string = f"${tex}$"
        katex.replace_with(replacement)

    output_path.write_text(str(soup), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
