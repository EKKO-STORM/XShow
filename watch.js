const watchElements = {
  ambientBackdrop: document.getElementById("ambient-backdrop"),
  ambientVideoWrap: document.getElementById("ambient-video-wrap"),
  cursorGlow: document.getElementById("cursor-glow"),
  cursorRing: document.getElementById("cursor-ring"),
  watchStage: document.getElementById("watch-stage"),
  watchCategory: document.getElementById("watch-category"),
  watchTitle: document.getElementById("watch-title"),
  watchDescription: document.getElementById("watch-description"),
  watchStyle: document.getElementById("watch-style"),
  watchDuration: document.getElementById("watch-duration"),
  watchStatus: document.getElementById("watch-status"),
  watchTags: document.getElementById("watch-tags"),
  relatedGrid: document.getElementById("related-grid")
};

const watchRevealElements = document.querySelectorAll(".reveal");

document.addEventListener("DOMContentLoaded", () => {
  setupRevealObserver();
  setupCursorEffect();
  loadTrailerPage();
});

function setupRevealObserver() {
  if (!("IntersectionObserver" in window)) {
    watchRevealElements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.16,
      rootMargin: "0px 0px -8% 0px"
    }
  );

  watchRevealElements.forEach((element) => {
    if (!element.classList.contains("is-visible")) {
      observer.observe(element);
    }
  });
}

function setupCursorEffect() {
  if (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  document.body.classList.add("cursor-enabled");

  let currentX = window.innerWidth / 2;
  let currentY = window.innerHeight / 2;
  let targetX = currentX;
  let targetY = currentY;

  const tick = () => {
    currentX += (targetX - currentX) * 0.18;
    currentY += (targetY - currentY) * 0.18;
    watchElements.cursorGlow.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`;
    watchElements.cursorRing.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%) scale(var(--cursor-scale))`;
    window.requestAnimationFrame(tick);
  };

  document.addEventListener("pointermove", (event) => {
    targetX = event.clientX;
    targetY = event.clientY;
    watchElements.cursorGlow.classList.add("is-visible");
    watchElements.cursorRing.classList.add("is-visible");
  });

  document.addEventListener("pointerdown", () => {
    watchElements.cursorRing.classList.add("is-pressed");
  });

  document.addEventListener("pointerup", () => {
    watchElements.cursorRing.classList.remove("is-pressed");
  });

  document.addEventListener("mouseover", (event) => {
    if (event.target.closest("a, button")) {
      watchElements.cursorRing.classList.add("is-active");
    }
  });

  document.addEventListener("mouseout", (event) => {
    if (event.target.closest("a, button")) {
      watchElements.cursorRing.classList.remove("is-active");
    }
  });

  window.requestAnimationFrame(tick);
}

async function loadTrailerPage() {
  const slug = decodeURIComponent(window.location.pathname.replace(/^\/watch\//, "").replace(/\/$/, ""));

  if (!slug) {
    renderError("Trailer slug is missing.");
    return;
  }

  try {
    const response = await fetch(`/api/trailers/${encodeURIComponent(slug)}`, {
      credentials: "same-origin",
      cache: "no-store"
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load trailer.");
    }

    renderTrailer(payload.trailer);
    renderRelated(payload.related);
  } catch (error) {
    renderError(error.message);
  }
}

function renderTrailer(trailer) {
  document.title = `XShow | ${trailer.title}`;
  watchElements.watchCategory.textContent = trailer.category;
  watchElements.watchTitle.textContent = trailer.title;
  watchElements.watchDescription.textContent = trailer.description;
  watchElements.watchStyle.textContent = `Style: ${trailer.style}`;
  watchElements.watchDuration.textContent = `Duration: ${trailer.durationLabel}`;
  watchElements.watchStatus.textContent = `Status: ${trailer.status}`;
  watchElements.watchTags.innerHTML = trailer.tags
    .map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`)
    .join("");
  watchElements.watchStage.className = `watch-stage tone-${trailer.posterTone}`;
  watchElements.watchStage.innerHTML = trailer.videoUrl
    ? `
        <video
          class="watch-video"
          src="${encodeURI(trailer.videoUrl)}"
          autoplay
          muted
          loop
          playsinline
          controls
        ></video>
      `
    : `
        <div class="poster-shell">
          <div class="poster-copy">
            <p class="caption-tag">${escapeHtml(trailer.category)}</p>
            <h2>${escapeHtml(trailer.title)}</h2>
            <p>${escapeHtml(trailer.description)}</p>
          </div>
        </div>
      `;

  watchElements.ambientBackdrop.dataset.tone = trailer.posterTone;
  watchElements.ambientVideoWrap.innerHTML = trailer.videoUrl
    ? `
        <video
          class="ambient-video"
          src="${encodeURI(trailer.videoUrl)}"
          autoplay
          muted
          loop
          playsinline
        ></video>
      `
    : "";
}

function renderRelated(related) {
  if (!related.length) {
    watchElements.relatedGrid.innerHTML =
      '<div class="empty-state">No related trailers yet. Upload more to grow the library.</div>';
    return;
  }

  watchElements.relatedGrid.innerHTML = related
    .map(
      (video) => `
        <article class="catalog-card reveal is-visible">
          <div class="card-visual tone-${escapeHtml(video.posterTone)}">
            <div class="card-chip-row">
              <span class="card-chip">${escapeHtml(video.category)}</span>
              <span class="card-chip">${escapeHtml(video.durationLabel)}</span>
            </div>
          </div>

          <div class="card-content">
            <p class="caption-tag">${escapeHtml(video.style)}</p>
            <h3>${escapeHtml(video.title)}</h3>
            <p>${escapeHtml(video.description)}</p>

            <div class="tag-row">
              ${video.tags.slice(0, 3).map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("")}
            </div>

            <div class="card-actions">
              <span class="micro-pill">${escapeHtml(video.status)}</span>
              <a class="card-link" href="${video.watchUrl}">Open Watch Page</a>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderError(message) {
  document.title = "XShow | Trailer Not Found";
  watchElements.watchCategory.textContent = "Unavailable";
  watchElements.watchTitle.textContent = "Trailer unavailable";
  watchElements.watchDescription.textContent = message;
  watchElements.watchStyle.textContent = "Style: --";
  watchElements.watchDuration.textContent = "Duration: --:--";
  watchElements.watchStatus.textContent = "Status: unavailable";
  watchElements.watchTags.innerHTML = "";
  watchElements.relatedGrid.innerHTML =
    '<div class="empty-state">We could not load this trailer. Go back home and choose another one.</div>';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
