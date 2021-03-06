#ifdef 0
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
#endif

/**
 * This class represents a site that is contained in a cell and can be pinned,
 * moved around or deleted.
 */
function Site(aNode, aLink) {
  this._node = aNode;
  this._node._newtabSite = this;

  this._link = aLink;

  this._render();
  this._addEventHandlers();
}

Site.prototype = {
  /**
   * The site's DOM node.
   */
  get node() { return this._node; },

  /**
   * The site's link.
   */
  get link() { return this._link; },

  /**
   * The url of the site's link.
   */
  get url() { return this.link.url; },

  /**
   * The title of the site's link.
   */
  get title() { return this.link.title; },

  /**
   * The site's parent cell.
   */
  get cell() {
    let parentNode = this.node.parentNode;
    return parentNode && parentNode._newtabCell;
  },

  /**
   * Pins the site on its current or a given index.
   * @param aIndex The pinned index (optional).
   */
  pin: function Site_pin(aIndex) {
    if (typeof aIndex == "undefined")
      aIndex = this.cell.index;

    this._updateAttributes(true);
    gPinnedLinks.pin(this._link, aIndex);
  },

  /**
   * Unpins the site and calls the given callback when done.
   */
  unpin: function Site_unpin() {
    if (this.isPinned()) {
      this._updateAttributes(false);
      gPinnedLinks.unpin(this._link);
      gUpdater.updateGrid();
    }
  },

  /**
   * Checks whether this site is pinned.
   * @return Whether this site is pinned.
   */
  isPinned: function Site_isPinned() {
    return gPinnedLinks.isPinned(this._link);
  },

  /**
   * Blocks the site (removes it from the grid) and calls the given callback
   * when done.
   */
  block: function Site_block() {
    if (!gBlockedLinks.isBlocked(this._link)) {
      gUndoDialog.show(this);
      gBlockedLinks.block(this._link);
      gUpdater.updateGrid();
    }
  },

  /**
   * Gets the DOM node specified by the given query selector.
   * @param aSelector The query selector.
   * @return The DOM node we found.
   */
  _querySelector: function Site_querySelector(aSelector) {
    return this.node.querySelector(aSelector);
  },

  /**
   * Updates attributes for all nodes which status depends on this site being
   * pinned or unpinned.
   * @param aPinned Whether this site is now pinned or unpinned.
   */
  _updateAttributes: function (aPinned) {
    let control = this._querySelector(".newtab-control-pin");

    if (aPinned) {
      this.node.setAttribute("pinned", true);
      control.setAttribute("title", newTabString("unpin"));
    } else {
      this.node.removeAttribute("pinned");
      control.setAttribute("title", newTabString("pin"));
    }
  },

  /**
   * Renders the site's data (fills the HTML fragment).
   */
  _render: function Site_render() {
    let enhanced = gAllPages.enhanced && DirectoryLinksProvider.getEnhancedLink(this.link);
    let url = this.url;
    let title = enhanced && enhanced.title || this.title || url;
    let tooltip = (title == url ? title : title + "\n" + url);

    let link = this._querySelector(".newtab-link");
    link.setAttribute("title", tooltip);
    link.setAttribute("href", url);
    this._querySelector(".newtab-title").textContent = title;
    this.node.setAttribute("type", this.link.type);

    if (this.link.targetedSite) {
      let targetedSite = `<strong> ${this.link.targetedSite} </strong>`;
      this._querySelector(".newtab-suggested").innerHTML =
        `<div class='newtab-suggested-bounds'> ${newTabString("suggested.button", [targetedSite])} </div>`;
    }

    if (this.isPinned())
      this._updateAttributes(true);
    // Capture the page if the thumbnail is missing, which will cause page.js
    // to be notified and call our refreshThumbnail() method.
    this.captureIfMissing();
    // but still display whatever thumbnail might be available now.
    this.refreshThumbnail();
  },

  /**
   * Captures the site's thumbnail in the background, but only if there's no
   * existing thumbnail and the page allows background captures.
   */
  captureIfMissing: function Site_captureIfMissing() {
    if (!document.hidden && !this.link.imageURI) {
      BackgroundPageThumbs.captureIfMissing(this.url);
    }
  },

  /**
   * Refreshes the thumbnail for the site.
   */
  refreshThumbnail: function Site_refreshThumbnail() {
    // Only enhance tiles if that feature is turned on
    let link = gAllPages.enhanced && DirectoryLinksProvider.getEnhancedLink(this.link) ||
               this.link;

    let thumbnail = this._querySelector(".newtab-thumbnail");
    if (link.bgColor) {
      thumbnail.style.backgroundColor = link.bgColor;
    }

    let uri = link.imageURI || PageThumbs.getThumbnailURL(this.url);
    thumbnail.style.backgroundImage = 'url("' + uri + '")';

    if (link.enhancedImageURI) {
      let enhanced = this._querySelector(".enhanced-content");
      enhanced.style.backgroundImage = 'url("' + link.enhancedImageURI + '")';

      if (this.link.type != link.type) {
        this.node.setAttribute("type", "enhanced");
        this.enhancedId = link.directoryId;
      }
    }
  },

  _ignoreHoverEvents: function(element) {
    element.addEventListener("mouseover", () => {
      this.cell.node.setAttribute("ignorehover", "true");
    });
    element.addEventListener("mouseout", () => {
      this.cell.node.removeAttribute("ignorehover");
    });
  },

  /**
   * Adds event handlers for the site and its buttons.
   */
  _addEventHandlers: function Site_addEventHandlers() {
    // Register drag-and-drop event handlers.
    this._node.addEventListener("dragstart", this, false);
    this._node.addEventListener("dragend", this, false);
    this._node.addEventListener("mouseover", this, false);

    // Specially treat the sponsored icon & suggested explanation
    // text to prevent regular hover effects
    let sponsored = this._querySelector(".newtab-sponsored");
    let suggested = this._querySelector(".newtab-suggested");
    this._ignoreHoverEvents(sponsored);
    this._ignoreHoverEvents(suggested);
  },

  /**
   * Speculatively opens a connection to the current site.
   */
  _speculativeConnect: function Site_speculativeConnect() {
    let sc = Services.io.QueryInterface(Ci.nsISpeculativeConnect);
    let uri = Services.io.newURI(this.url, null, null);
    sc.speculativeConnect(uri, null);
  },

  /**
   * Record interaction with site using telemetry.
   */
  _recordSiteClicked: function Site_recordSiteClicked(aIndex) {
    if (Services.prefs.prefHasUserValue("browser.newtabpage.rows") ||
        Services.prefs.prefHasUserValue("browser.newtabpage.columns") ||
        aIndex > 8) {
      // We only want to get indices for the default configuration, everything
      // else goes in the same bucket.
      aIndex = 9;
    }
    Services.telemetry.getHistogramById("NEWTAB_PAGE_SITE_CLICKED")
                      .add(aIndex);
  },

  _toggleSponsored: function() {
    let button = this._querySelector(".newtab-sponsored");
    if (button.hasAttribute("active")) {
      let explain = this._querySelector(".sponsored-explain");
      explain.parentNode.removeChild(explain);

      button.removeAttribute("active");
    }
    else {
      let explain = document.createElementNS(HTML_NAMESPACE, "div");
      explain.className = "sponsored-explain";
      this.node.appendChild(explain);

      let link = '<a href="' + TILES_EXPLAIN_LINK + '">' +
                 newTabString("learn.link") + "</a>";
      let type = this.node.getAttribute("type");
      let icon = '<input type="button" class="newtab-control newtab-' +
                 (type == "sponsored" ? "control-block" : "customize") + '"/>';
      explain.innerHTML = newTabString(type + ".explain", [icon, link]);

      button.setAttribute("active", "true");
    }
  },

  /**
   * Handles site click events.
   */
  onClick: function Site_onClick(aEvent) {
    let action;
    let pinned = this.isPinned();
    let tileIndex = this.cell.index;
    let {button, target} = aEvent;

    // Handle tile/thumbnail link click
    if (target.classList.contains("newtab-link") ||
        target.parentElement.classList.contains("newtab-link")) {
      // Record for primary and middle clicks
      if (button == 0 || button == 1) {
        this._recordSiteClicked(tileIndex);
        action = "click";
      }
    }
    // Handle sponsored explanation link click
    else if (target.parentElement.classList.contains("sponsored-explain")) {
      action = "sponsored_link";
    }
    // Only handle primary clicks for the remaining targets
    else if (button == 0) {
      if (target.parentElement.classList.contains("newtab-suggested") ||
          target.classList.contains("newtab-suggested")) {
        // Suggested explanation text should do nothing when clicked and
        // the link in the suggested explanation should act as default.
        return;
      }
      aEvent.preventDefault();
      if (target.classList.contains("newtab-control-block")) {
        this.block();
        action = "block";
      }
      else if (target.classList.contains("sponsored-explain") ||
               target.classList.contains("newtab-sponsored")) {
        this._toggleSponsored();
        action = "sponsored";
      }
      else if (pinned) {
        this.unpin();
        action = "unpin";
      }
      else {
        this.pin();
        action = "pin";
      }
    }

    // Report all link click actions
    DirectoryLinksProvider.reportSitesAction(gGrid.sites, action, tileIndex);
  },

  /**
   * Handles all site events.
   */
  handleEvent: function Site_handleEvent(aEvent) {
    switch (aEvent.type) {
      case "mouseover":
        this._node.removeEventListener("mouseover", this, false);
        this._speculativeConnect();
        break;
      case "dragstart":
        gDrag.start(this, aEvent);
        break;
      case "dragend":
        gDrag.end(this, aEvent);
        break;
    }
  }
};
