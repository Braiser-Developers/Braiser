const COURSE_URL = "https://course.pku.edu.cn";

const tabList = document.getElementById("tabList");
const tabCount = document.getElementById("tabCount");
const emptyState = document.getElementById("emptyState");
const newTabButton = document.getElementById("newTabButton");
const closeRightmostButton = document.getElementById("closeRightmostButton");

async function getCurrentWindowTabs() {
  return chrome.tabs.query({ currentWindow: true });
}

function renderTabs(tabs) {
  tabList.replaceChildren();
  tabCount.textContent = String(tabs.length);
  emptyState.hidden = tabs.length > 0;

  for (const tab of tabs) {
    const item = document.createElement("li");
    item.className = "tab-item";

    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = tab.title || "未命名标签页";

    const url = document.createElement("div");
    url.className = "tab-url";
    url.textContent = tab.url || "";

    item.append(title, url);
    tabList.append(item);
  }
}

async function refreshTabs() {
  const tabs = await getCurrentWindowTabs();
  renderTabs(tabs);
}

async function openCourseTabAtRight() {
  const tabs = await getCurrentWindowTabs();
  const createProperties = {
    url: COURSE_URL,
    index: tabs.length
  };

  if (tabs[0]?.windowId) {
    createProperties.windowId = tabs[0].windowId;
  }

  await chrome.tabs.create(createProperties);
  await refreshTabs();
}

async function closeRightmostTab() {
  const tabs = await getCurrentWindowTabs();
  const rightmostTab = tabs.reduce((rightmost, tab) => {
    return tab.index > rightmost.index ? tab : rightmost;
  }, tabs[0]);

  if (!rightmostTab?.id) {
    return;
  }

  await chrome.tabs.remove(rightmostTab.id);
  await refreshTabs();
}

newTabButton.addEventListener("click", openCourseTabAtRight);
closeRightmostButton.addEventListener("click", closeRightmostTab);

refreshTabs();
