
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com"
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "data:"
        ],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        mediaSrc: ["'self'", "blob:", "https:"],
        connectSrc: ["'self'"],
        frameSrc: ["https://www.instagram.com"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null
      }
    }
  })
);

app.use(express.json({ limit: "10kb" }));

app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(express.static(path.join(__dirname, "public")));

function inspectInstagramUrl(raw) {
  if (!raw || raw.length > 2048) {
    throw new Error("Please paste a valid Instagram link.");
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }

  if (
    parsed.protocol !== "https:" ||
    !["instagram.com", "www.instagram.com"].includes(
      parsed.hostname.toLowerCase()
    ) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Please use an HTTPS Instagram post or Reel URL.");
  }

  const match = parsed.pathname.match(
    /^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?$/
  );

  if (!match) {
    throw new Error(
      "Supported links look like instagram.com/p/SHORTCODE/ or instagram.com/reel/SHORTCODE/."
    );
  }

  const section = match[1];
  const shortcode = match[2];

  const kind =
    section === "p" ? "post" :
    section === "tv" ? "video" :
    "reel";

  const permalink =
    "https://www.instagram.com/" + section + "/" + shortcode + "/";

  return {
    kind,
    permalink,
    embedUrl: permalink + "embed/"
  };
}

// SaveAPI integration.
// Confirm the endpoint, authentication, and response format
// against the API documentation for your account.
async function retrieveMedia(instagramUrl) {
  const apiKey = process.env.SAVEAPI_KEY;

  if (!apiKey) {
    throw new Error("SAVEAPI_KEY is missing from your .env file.");
  }

  const endpoint = new URL("https://api.saveapi.org/v1/download");
  endpoint.searchParams.set("url", instagramUrl);

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + apiKey,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(30000)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
  console.error("SaveAPI HTTP status:", response.status);
  console.error("SaveAPI error response:", JSON.stringify(result));

  throw new Error(
    response.status === 401
      ? "SaveAPI rejected the API key. Check that it is active and copied correctly."
      : "SaveAPI request failed. Check the server terminal for details."
  );
}

  // Expected response format: { success: true, medias: [{ url, type, ext }] }
  // Adjust this mapping if your provider returns a different structure.
  if (!result.success || !Array.isArray(result.medias)) {
    console.error("Unexpected SaveAPI response structure.");

    throw new Error(
      "The API responded, but its response format was different from expected."
    );
  }

  const mediaItems = result.medias
    .filter(item => {
      if (!item || typeof item.url !== "string") return false;

      try {
        return new URL(item.url).protocol === "https:";
      } catch {
        return false;
      }
    })
    .map(item => ({
      mediaUrl: item.url,
      type: item.type || "media",
      extension: item.ext || ""
    }));

  if (mediaItems.length === 0) {
    throw new Error("No downloadable media was returned for this post.");
  }

  return mediaItems;
}

app.get("/api/status", (req, res) => {
  res.json({
    running: true,
    mediaApiConfigured: Boolean(process.env.SAVEAPI_KEY)
  });
});

app.post("/api/inspect-url", async (req, res) => {
  let data;

  try {
    data = inspectInstagramUrl(
      String(req.body?.url || "").trim()
    );
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const mediaItems = await retrieveMedia(data.permalink);

    res.json({
      ...data,
      mediaUrl: mediaItems[0].mediaUrl,
      mediaItems,
      message: "Media retrieved successfully."
    });
  } catch (error) {
    console.error("Media retrieval failed:", error.message);

    res.status(502).json({
      error: error.message || "Unable to retrieve this media."
    });
  }
});

app.get("/api/download-media", async (req, res) => {
  try {
    const data = inspectInstagramUrl(
      String(req.query.url || "").trim()
    );

    const mediaItems = await retrieveMedia(data.permalink);
    const media = mediaItems[0];

    if (!media || !media.mediaUrl) {
      return res.status(404).send("No downloadable media found.");
    }

    const mediaUrl = new URL(media.mediaUrl);

    if (mediaUrl.protocol !== "https:") {
      return res.status(400).send("Invalid media URL.");
    }

    const response = await fetch(mediaUrl, {
      signal: AbortSignal.timeout(60000),
      redirect: "error"
    });

    if (!response.ok || !response.body) {
      return res.status(502).send("Could not fetch the media file.");
    }

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";

    const extension =
      media.extension && /^[a-zA-Z0-9]{1,10}$/.test(media.extension)
        ? media.extension.toLowerCase()
        : contentType.includes("video") ? "mp4" : "jpg";

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="instasave-download.${extension}"`
    );
    res.setHeader("X-Content-Type-Options", "nosniff");

    const { Readable } = require("node:stream");
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error("Download failed:", error.message);

    if (!res.headersSent) {
      res.status(502).send("Download failed. Please try again.");
    } else {
      res.destroy(error);
    }
  }
});


app.listen(PORT, () => {
  console.log("InstaSave running at http://localhost:" + PORT);
});
