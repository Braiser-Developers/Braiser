import io
import sys
from pathlib import Path

from bs4 import BeautifulSoup
from markitdown._base_converter import DocumentConverterResult
from markitdown._stream_info import StreamInfo
from markitdown.converters._html_converter import HtmlConverter
from markitdown.converters._markdownify import _CustomMarkdownify


MATH_DISPLAY_CLASS = "braiser-markdown-math-display"
MATH_INLINE_CLASS = "braiser-markdown-math-inline"


class BraiserMarkdownify(_CustomMarkdownify):
    def convert_div(self, el, text, parent_tags):
        if has_class(el, MATH_DISPLAY_CLASS):
            return "\n\n" + el.get_text("", strip=False) + "\n\n"
        return super().convert_div(el, text, parent_tags)

    def convert_span(self, el, text, parent_tags):
        if has_class(el, MATH_INLINE_CLASS):
            return el.get_text("", strip=False)
        return text


class BraiserHtmlConverter(HtmlConverter):
    def convert(self, file_stream, stream_info: StreamInfo, **kwargs) -> DocumentConverterResult:
        encoding = "utf-8" if stream_info.charset is None else stream_info.charset
        soup = BeautifulSoup(file_stream, "html.parser", from_encoding=encoding)

        for script in soup(["script", "style"]):
            script.extract()

        body = soup.find("body")
        root = body if body is not None else soup
        markdown = BraiserMarkdownify(**kwargs).convert_soup(root).strip()

        return DocumentConverterResult(
            markdown=markdown,
            title=None if soup.title is None else soup.title.string,
        )

    def convert_string(self, html_content: str, *, url=None, **kwargs) -> DocumentConverterResult:
        return self.convert(
            file_stream=io.BytesIO(html_content.encode("utf-8")),
            stream_info=StreamInfo(
                mimetype="text/html",
                extension=".html",
                charset="utf-8",
                url=url,
            ),
            **kwargs,
        )


def has_class(el, class_name: str) -> bool:
    classes = el.get("class") or []
    return class_name in classes


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: markitdown-braiser.py input.html output.md", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    result = BraiserHtmlConverter().convert(
        input_path.open("rb"),
        StreamInfo(
            mimetype="text/html",
            extension=".html",
            charset="utf-8",
        ),
    )
    output_path.write_text(result.markdown, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
