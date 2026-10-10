
const form = document.getElementById("urlForm");
const input = document.getElementById("instagramUrl");
const status = document.getElementById("statusText");
const resultPanel = document.getElementById("resultPanel");
const kindPill = document.getElementById("kindPill");
const openLink = document.getElementById("openLink");
const mediaResults = document.getElementById("mediaResults");
const inspectButton = document.getElementById("inspectButton");
const preview = document.getElementById("instagramPreview");
const embed = document.getElementById("instagramEmbed");

// Handle Instagram URL submission.
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const url = input.value.trim();

  status.textContent = "Retrieving media. Please wait...";
  inspectButton.disabled = true;
  resultPanel.hidden = true;
  mediaResults.replaceChildren();
  preview.hidden = true;
  embed.removeAttribute("src");

  try {
    const response = await fetch("/api/inspect-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not retrieve media.");
    }

    resultPanel.hidden = false;
    kindPill.textContent = data.kind || "Instagram media";
    openLink.href = data.permalink;

    if (data.embedUrl) {
      embed.src = data.embedUrl;
      preview.hidden = false;
    }

    const items = Array.isArray(data.mediaItems)
      ? data.mediaItems
      : data.mediaUrl
        ? [{ mediaUrl: data.mediaUrl, type: "media" }]
        : [];

    if (items.length === 0) {
      throw new Error("The API returned no downloadable media.");
    }

    items.forEach((item, index) => {
      if (!item.mediaUrl) return;

      const card = document.createElement("div");
      card.className = "media-download-card";

      const title = document.createElement("p");
      title.textContent =
        (item.type || "Media") + " " + (index + 1);

      
      const link = document.createElement("a");
          link.className = "primary-button download-button";

          link.href ="/api/download-media?url=" + encodeURIComponent(data.permalink);

          link.textContent = "↓ Download " + (index + 1);
          link.setAttribute("aria-label", "Download media " + (index + 1));


      card.append(title, link);
      mediaResults.appendChild(card);
    });

    if (!mediaResults.children.length) {
      throw new Error("No usable download links were returned.");
    }

    status.textContent = "Media found! Choose a download link below.";
  } catch (error) {
    resultPanel.hidden = true;
    status.textContent = error.message || "Something went wrong.";
  } finally {
    inspectButton.disabled = false;
  }
});

// Keep the existing local file saver working.
const mediaFile = document.getElementById("mediaFile");
const fileDetails = document.getElementById("fileDetails");
const saveFileButton = document.getElementById("saveFileButton");

let selectedFile = null;

if (mediaFile && fileDetails && saveFileButton) {
  mediaFile.addEventListener("change", () => {
    selectedFile = mediaFile.files[0] || null;

    fileDetails.textContent = selectedFile
      ? selectedFile.name + " (" +
        (selectedFile.size / (1024 * 1024)).toFixed(2) + " MB)"
      : "No file selected.";

    saveFileButton.disabled = !selectedFile;
  });

  saveFileButton.addEventListener("click", () => {
    if (!selectedFile) return;

    const blobUrl = URL.createObjectURL(selectedFile);
    const link = document.createElement("a");

    link.href = blobUrl;
    link.download = selectedFile.name;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  });
}
