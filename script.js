const state = {
  home: null,
  selectedCategory: "All",
  selectedTrailerId: null
};

const elements = {
  ambientBackdrop: document.getElementById("ambient-backdrop"),
  ambientVideoWrap: document.getElementById("ambient-video-wrap"),
  cursorGlow: document.getElementById("cursor-glow"),
  cursorRing: document.getElementById("cursor-ring"),
  heroSummary: document.getElementById("hero-summary"),
  heroNote: document.getElementById("hero-note"),
  heroWatchLink: document.getElementById("hero-watch-link"),
  featuredCategory: document.getElementById("featured-category"),
  spotlightStage: document.getElementById("spotlight-stage"),
  spotlightStyle: document.getElementById("spotlight-style"),
  spotlightTitle: document.getElementById("spotlight-title"),
  spotlightDescription: document.getElementById("spotlight-description"),
  spotlightTags: document.getElementById("spotlight-tags"),
  spotlightMetaLine: document.getElementById("spotlight-meta-line"),
  featuredWatchLink: document.getElementById("featured-watch-link"),
  categoryFilters: document.getElementById("category-filters"),
  trailerGrid: document.getElementById("trailer-grid"),
  creatorStatusPill: document.getElementById("creator-status-pill"),
  creatorModeIndicator: document.getElementById("creator-mode-indicator"),
  creatorPanelTitle: document.getElementById("creator-panel-title"),
  creatorPanelCopy: document.getElementById("creator-panel-copy"),
  creatorLoginForm: document.getElementById("creator-login-form"),
  creatorAuthPanel: document.getElementById("creator-auth-panel"),
  creatorFeedback: document.getElementById("creator-feedback"),
  uploadForm: document.getElementById("upload-form"),
  uploadFeedback: document.getElementById("upload-feedback"),
  uploadLockedCopy: document.getElementById("upload-locked-copy"),
  logoutButton: document.getElementById("logout-button")
};

const revealElements = document.querySelectorAll(".reveal");

document.addEventListener("DOMContentLoaded", () => {
  setupRevealObserver();
  setupCursorEffect();
  bindEvents();
  refreshHome();
});

function setupRevealObserver() {
  if (!("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("is-visible"));
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

  revealElements.forEach((element) => {
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
    elements.cursorGlow.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`;
    elements.cursorRing.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%) scale(var(--cursor-scale))`;
    window.requestAnimationFrame(tick);
  };

  document.addEventListener("pointermove", (event) => {
    targetX = event.clientX;
    targetY = event.clientY;
    elements.cursorGlow.classList.add("is-visible");
    elements.cursorRing.classList.add("is-visible");
  });

  document.addEventListener("pointerdown", () => {
    elements.cursorRing.classList.add("is-pressed");
  });

  document.addEventListener("pointerup", () => {
    elements.cursorRing.classList.remove("is-pressed");
  });

  document.addEventListener("mouseover", (event) => {
    if (event.target.closest("a, button, input, textarea, .catalog-card, .filter-chip")) {
      elements.cursorRing.classList.add("is-active");
    }
  });

  document.addEventListener("mouseout", (event) => {
    if (event.target.closest("a, button, input, textarea, .catalog-card, .filter-chip")) {
      elements.cursorRing.classList.remove("is-active");
    }
  });

  window.requestAnimationFrame(tick);
}

function bindEvents() {
  elements.categoryFilters.addEventListener("click", handleCategoryClick);
  elements.creatorLoginForm.addEventListener("submit", handleCreatorLogin);
  elements.logoutButton.addEventListener("click", handleCreatorLogout);
  elements.uploadForm.addEventListener("submit", handleUpload);
}

async function refreshHome() {
  try {
    const response = await fetch("/api/home", {
      credentials: "same-origin",
      cache: "no-store"
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load XShow.");
    }

    state.home = payload;

    if (!payload.categories.includes(state.selectedCategory)) {
      state.selectedCategory = "All";
    }

    const featuredTrailer = payload.featuredTrailer || payload.trailers[0] || null;
    const visibleTrailers = getVisibleTrailers(payload.trailers);

    if (state.selectedTrailerId === null && featuredTrailer) {
      state.selectedTrailerId = featuredTrailer.id;
    }

    if (!visibleTrailers.some((video) => video.id === state.selectedTrailerId)) {
      state.selectedTrailerId = visibleTrailers[0]?.id ?? featuredTrailer?.id ?? null;
    }

    renderHome();
  } catch (error) {
    renderLoadFailure(error.message);
  }
}

function getVisibleTrailers(trailers = state.home?.trailers || []) {
  if (state.selectedCategory === "All") {
    return trailers;
  }

  return trailers.filter((video) => video.category === state.selectedCategory);
}

function getSelectedTrailer() {
  return (
    state.home?.trailers.find((video) => video.id === state.selectedTrailerId) ||
    state.home?.featuredTrailer ||
    state.home?.trailers[0] ||
    null
  );
}

function renderHome() {
  renderHeroCopy();
  renderFilters();
  renderTrailers();
  renderFeaturedTrailer();
  renderCreatorState();
}

function renderHeroCopy() {
  const trailerCount = state.home.counts?.trailers || state.home.trailers.length;
  const categoryCount = state.home.counts?.categories || Math.max(state.home.categories.length - 1, 0);
  elements.heroSummary.textContent = state.home.hero.summary;
  elements.heroNote.textContent =
    trailerCount > 0
      ? `${trailerCount} live trailers across ${Math.max(categoryCount, 1)} categories.`
      : "Upload your first trailer to start the site.";
}

function renderFilters() {
  elements.categoryFilters.innerHTML = state.home.categories
    .map(
      (category) => `
        <button
          class="filter-chip ${category === state.selectedCategory ? "is-active" : ""}"
          type="button"
          data-category="${escapeHtml(category)}"
        >
          ${escapeHtml(category)}
        </button>
      `
    )
    .join("");
}

function renderTrailers() {
  const trailers = getVisibleTrailers();

  if (!trailers.length) {
    elements.trailerGrid.innerHTML =
      '<div class="empty-state">No trailers match this category yet. Try another filter or upload a new one.</div>';
    return;
  }

  elements.trailerGrid.innerHTML = trailers.map(renderTrailerCard).join("");

  elements.trailerGrid.querySelectorAll("[data-preview-id]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedTrailerId = Number(card.dataset.previewId);
      renderFeaturedTrailer();
      renderTrailers();
    });
  });

  elements.trailerGrid.querySelectorAll("[data-watch-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });
}

function renderTrailerCard(video) {
  const isSelected = video.id === state.selectedTrailerId;

  return `
    <article class="catalog-card ${isSelected ? "is-selected" : ""} reveal is-visible" data-preview-id="${video.id}">
      <div class="card-visual tone-${escapeHtml(video.posterTone)}">
        <div class="card-chip-row">
          <span class="card-chip">${escapeHtml(video.category)}</span>
          <span class="card-chip">${isSelected ? "Now Previewing" : "Preview Here"}</span>
        </div>
      </div>

      <div class="card-content">
        <p class="caption-tag">${escapeHtml(video.style)}</p>
        <h3>${escapeHtml(video.title)}</h3>
        <p>${escapeHtml(video.description)}</p>

        <div class="tag-row">
          ${video.tags.slice(0, 3).map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("")}
        </div>

        <div class="card-meta">
          <span>${escapeHtml(video.durationLabel)}</span>
          <span>${escapeHtml(video.status)}</span>
        </div>

        <div class="card-actions">
          <span class="micro-pill">${video.videoUrl ? "Playable" : "Poster preview"}</span>
          <a class="card-link" href="${video.watchUrl}" data-watch-link>Open Watch Page</a>
        </div>
      </div>
    </article>
  `;
}

function renderFeaturedTrailer() {
  const trailer = getSelectedTrailer();

  if (!trailer) {
    elements.featuredCategory.textContent = "Trailer";
    elements.spotlightStyle.textContent = "Trailer feed";
    elements.spotlightTitle.textContent = "No trailer selected";
    elements.spotlightDescription.textContent = "Upload a trailer to begin building the library.";
    elements.spotlightTags.innerHTML = "";
    elements.spotlightMetaLine.textContent = "Duration: --:--";
    elements.featuredWatchLink.href = "/";
    elements.heroWatchLink.href = "#trailers";
    elements.spotlightStage.className = "spotlight-stage tone-midnight";
    elements.spotlightStage.innerHTML = `
      <div class="poster-shell">
        <div class="poster-copy">
          <p class="caption-tag">Trailer feed</p>
          <h2>No trailer selected</h2>
          <p>Upload a trailer or choose one from the library below.</p>
        </div>
      </div>
    `;
    renderAmbientBackdrop(null);
    return;
  }

  elements.featuredCategory.textContent = trailer.category;
  elements.spotlightStyle.textContent = trailer.style;
  elements.spotlightTitle.textContent = trailer.title;
  elements.spotlightDescription.textContent = trailer.description;
  elements.spotlightTags.innerHTML = trailer.tags
    .map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`)
    .join("");
  elements.spotlightMetaLine.textContent = `${trailer.durationLabel} · ${trailer.category} · ${trailer.status}`;
  elements.featuredWatchLink.href = trailer.watchUrl;
  elements.featuredWatchLink.textContent = "Open Watch Page";
  elements.heroWatchLink.href = trailer.watchUrl;
  elements.heroWatchLink.textContent = "Watch Featured";
  elements.spotlightStage.className = `spotlight-stage tone-${trailer.posterTone}`;
  elements.spotlightStage.innerHTML = trailer.videoUrl
    ? `
        <video
          class="spotlight-video"
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
  renderAmbientBackdrop(trailer);
}

function renderAmbientBackdrop(trailer) {
  const tone = trailer?.posterTone || "midnight";
  elements.ambientBackdrop.dataset.tone = tone;
  elements.ambientVideoWrap.innerHTML = trailer?.videoUrl
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

function renderCreatorState() {
  const creatorEnabled = Boolean(state.home.creator?.isAuthenticated);

  elements.creatorStatusPill.textContent = creatorEnabled ? "Creator Mode" : "Viewer Mode";
  elements.creatorModeIndicator.textContent = creatorEnabled ? "Unlocked" : "Locked";
  elements.creatorPanelTitle.textContent = creatorEnabled ? "Upload area is ready" : "Unlock uploads";
  elements.creatorPanelCopy.textContent = creatorEnabled
    ? "Trailer uploads are enabled. New uploads instantly get a watch page and appear in the homepage library."
    : "Enter your creator access key to enable trailer uploads.";
  elements.creatorLoginForm.hidden = creatorEnabled;
  elements.creatorAuthPanel.hidden = !creatorEnabled;
  elements.uploadForm.hidden = !creatorEnabled;
  elements.uploadLockedCopy.hidden = creatorEnabled;
}

function handleCategoryClick(event) {
  const button = event.target.closest("[data-category]");

  if (!button || !state.home) {
    return;
  }

  state.selectedCategory = button.dataset.category;
  const visibleTrailers = getVisibleTrailers();

  if (!visibleTrailers.some((video) => video.id === state.selectedTrailerId)) {
    state.selectedTrailerId = visibleTrailers[0]?.id ?? state.home.featuredTrailer?.id ?? null;
  }

  renderFilters();
  renderTrailers();
  renderFeaturedTrailer();
}

async function handleCreatorLogin(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);
  const accessKey = String(formData.get("accessKey") || "").trim();

  if (!accessKey) {
    setFeedback(elements.creatorFeedback, "Enter your creator access key first.", "error");
    return;
  }

  setFeedback(elements.creatorFeedback, "Unlocking upload area...", "");

  try {
    const response = await fetch("/api/admin/session", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ accessKey })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to unlock uploads.");
    }

    form.reset();
    setFeedback(elements.creatorFeedback, "Upload area unlocked.", "success");
    await refreshHome();
  } catch (error) {
    setFeedback(elements.creatorFeedback, error.message, "error");
  }
}

async function handleCreatorLogout() {
  try {
    await fetch("/api/admin/session", {
      method: "DELETE",
      credentials: "same-origin"
    });
    setFeedback(elements.creatorFeedback, "Upload area locked.", "");
    await refreshHome();
  } catch (error) {
    setFeedback(elements.creatorFeedback, error.message, "error");
  }
}

async function handleUpload(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);

  setFeedback(elements.uploadFeedback, "Uploading trailer...", "");

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      credentials: "same-origin",
      body: formData
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Upload failed.");
    }

    form.reset();
    setFeedback(elements.uploadFeedback, `${payload.video.title} is live in XShow.`, "success");
    state.selectedCategory = "All";
    state.selectedTrailerId = payload.video.id;
    await refreshHome();
  } catch (error) {
    setFeedback(elements.uploadFeedback, error.message, "error");
  }
}

function renderLoadFailure(message) {
  elements.heroSummary.textContent = message;
  elements.heroNote.textContent = "Refresh the page after the server is available again.";
  elements.trailerGrid.innerHTML =
    '<div class="empty-state">The trailer library is unavailable right now.</div>';
  elements.spotlightStage.className = "spotlight-stage tone-midnight";
  elements.spotlightStage.innerHTML = `
    <div class="poster-shell">
      <div class="poster-copy">
        <p class="caption-tag">Unavailable</p>
        <h2>Featured trailer could not load</h2>
        <p>${escapeHtml(message)}</p>
      </div>
    </div>
  `;
  elements.spotlightTitle.textContent = "Unable to load trailer";
  elements.spotlightDescription.textContent = message;
  elements.spotlightTags.innerHTML = "";
  elements.spotlightMetaLine.textContent = "Duration: --:--";
}

function setFeedback(element, message, tone) {
  element.textContent = message;
  element.classList.remove("is-success", "is-error");

  if (tone === "success") {
    element.classList.add("is-success");
  }

  if (tone === "error") {
    element.classList.add("is-error");
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
