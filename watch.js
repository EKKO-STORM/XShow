const watchElements = {
  ambientBackdrop: document.getElementById("ambient-backdrop"),
  ambientVideoWrap: document.getElementById("ambient-video-wrap"),
  cursorGlow: document.getElementById("cursor-glow"),
  cursorRing: document.getElementById("cursor-ring"),
  cursorCore: document.getElementById("cursor-core"),
  cursorLabel: document.getElementById("cursor-label"),
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
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !watchElements.cursorGlow ||
    !watchElements.cursorRing ||
    !watchElements.cursorCore ||
    !watchElements.cursorLabel
  ) {
    return;
  }

  document.body.classList.add("cursor-enabled");

  let currentX = window.innerWidth / 2;
  let currentY = window.innerHeight / 2;
  let glowX = currentX;
  let glowY = currentY;
  let coreX = currentX;
  let coreY = currentY;
  let targetX = currentX;
  let targetY = currentY;
  let hoverScale = 1;
  let pressScale = 1;

  const hideCursor = () => {
    hoverScale = 1;
    pressScale = 1;
    watchElements.cursorGlow.classList.remove("is-visible");
    watchElements.cursorRing.classList.remove("is-visible", "is-active", "is-pressed");
    watchElements.cursorCore.classList.remove("is-visible");
    watchElements.cursorLabel.classList.remove("is-visible", "is-active");
  };

  const setHoverTarget = (target) => {
    const interactive = target?.closest("[data-cursor-label], .catalog-card, a, button");
    const label = resolveCursorLabel(interactive);
    const isActive = Boolean(interactive);

    hoverScale = isActive ? 1.75 : 1;
    watchElements.cursorRing.classList.toggle("is-active", isActive);
    watchElements.cursorLabel.classList.toggle("is-visible", Boolean(label));
    watchElements.cursorLabel.classList.toggle("is-active", isActive);
    watchElements.cursorLabel.textContent = label;
  };

  const tick = () => {
    currentX += (targetX - currentX) * 0.2;
    currentY += (targetY - currentY) * 0.2;
    glowX += (targetX - glowX) * 0.1;
    glowY += (targetY - glowY) * 0.1;
    coreX += (targetX - coreX) * 0.34;
    coreY += (targetY - coreY) * 0.34;

    const dx = targetX - currentX;
    const dy = targetY - currentY;
    const angle = Math.atan2(dy, dx);
    const speed = Math.min(Math.hypot(dx, dy), 26);
    const stretch = 1 + speed * 0.015;
    const squeeze = Math.max(0.84, 1 - speed * 0.008);
    const scale = hoverScale * pressScale;

    watchElements.cursorGlow.style.transform = `translate3d(${glowX}px, ${glowY}px, 0) translate(-50%, -50%)`;
    watchElements.cursorRing.style.transform =
      `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%) rotate(${angle}rad) ` +
      `scale(${stretch * scale}, ${squeeze * scale})`;
    watchElements.cursorCore.style.transform = `translate3d(${coreX}px, ${coreY}px, 0) translate(-50%, -50%)`;
    watchElements.cursorLabel.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(20px, -28px)`;
    window.requestAnimationFrame(tick);
  };

  document.addEventListener("pointermove", (event) => {
    targetX = event.clientX;
    targetY = event.clientY;
    watchElements.cursorGlow.classList.add("is-visible");
    watchElements.cursorRing.classList.add("is-visible");
    watchElements.cursorCore.classList.add("is-visible");
    setHoverTarget(event.target);
  });

  document.addEventListener("pointerdown", () => {
    pressScale = 0.82;
    watchElements.cursorRing.classList.add("is-pressed");
  });

  document.addEventListener("pointerup", () => {
    pressScale = 1;
    watchElements.cursorRing.classList.remove("is-pressed");
  });

  document.addEventListener("mouseout", (event) => {
    if (event.relatedTarget) {
      return;
    }

    hideCursor();
  });

  window.addEventListener("blur", hideCursor);

  window.requestAnimationFrame(tick);
}

function resolveCursorLabel(target) {
  if (!target) {
    return "";
  }

  if (target.dataset.cursorLabel) {
    return target.dataset.cursorLabel;
  }

  if (target.matches(".catalog-card")) {
    return "Preview";
  }

  if (target.matches("button")) {
    return target.textContent.trim().split(/\s+/).slice(0, 2).join(" ") || "Select";
  }

  if (target.matches("a")) {
    return target.getAttribute("href")?.startsWith("/watch/") ? "Open" : "Go";
  }

  return "View";
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
        <article class="rail-card reveal is-visible" data-cursor-label="Preview">
          <div class="rail-card-visual tone-${escapeHtml(video.posterTone)}">
            <span class="rail-index">${escapeHtml(video.durationLabel)}</span>
            <div class="rail-card-overlay">
              <span class="card-chip">${escapeHtml(video.category)}</span>
              <span class="card-chip">${escapeHtml(video.style)}</span>
            </div>
          </div>

          <div class="rail-card-content">
            <p class="caption-tag">${escapeHtml(video.category)}</p>
            <h3>${escapeHtml(video.title)}</h3>
            <p>${escapeHtml(video.description)}</p>

            <div class="rail-card-actions">
              <span class="micro-pill">${escapeHtml(video.status)}</span>
              <a class="card-link" href="${video.watchUrl}" data-cursor-label="Open">Open Watch Page</a>
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
