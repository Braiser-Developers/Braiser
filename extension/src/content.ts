interface ReadablePage {
  title: string;
  url: string;
  html: string;
  text: string;
}

function getVisibleText(): string {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent?.trim();
      if (!text) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }

      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const chunks: string[] = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim();
    if (text) {
      chunks.push(text);
    }
  }

  return chunks.join("\n").replace(/\n{3,}/g, "\n\n");
}

function extractReadablePage(): ReadablePage {
  return {
    title: document.title,
    url: window.location.href,
    html: document.documentElement.outerHTML,
    text: getVisibleText()
  };
}

extractReadablePage();
