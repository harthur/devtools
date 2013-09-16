const {Cc, Ci, Cu} = require("chrome");

Cu.import("resource://gre/modules/Services.jsm");

let { CssColor } = require("devtools/magnifier/CSSColor");
let EventEmitter = require("devtools/shared/event-emitter");

loader.lazyGetter(this, "gDevTools",
  () => Cu.import("resource:///modules/devtools/gDevTools.jsm", {}).gDevTools);

loader.lazyGetter(this, "clipboardHelper", function() {
  return Cc["@mozilla.org/widget/clipboardhelper;1"].
    getService(Ci.nsIClipboardHelper);
});

const PANEL_STYLE = "background: rgba(0,100,150,0.1);" +
                    "height: 320px;width:310px";

const OUTLINE_STYLE = "border: solid 1px white; outline: solid 1px black;" +
                      "position: fixed; display: block; transition: all linear 0.1s;"

const XULNS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const MAGNIFIER_URL = "chrome://browser/content/devtools/magnifier.xul";
const ZOOM_PREF    = "devtools.magnifier.zoom";
const FORMAT_PREF    = "devtools.magnifier.format";

let MagnifierManager = {
  _instances: new WeakMap(),

  toggle: function(chromeWindow) {
    let magnifier = this.getInstance(chromeWindow);
    if (magnifier) {
      magnifier.destroy();
    }
    else {
      magnifier = this.createInstance(chromeWindow);
      magnifier.open();
    }
  },

  getInstance: function(chromeWindow) {
    return this._instances.get(chromeWindow);
  },

  createInstance: function(chromeWindow) {
    let magnifier = new Magnifier(chromeWindow);
    this._instances.set(chromeWindow, magnifier);

    magnifier.on("destroy", () => {
      this.deleteInstance(chromeWindow);
    });

    return magnifier;
  },

  deleteInstance: function(chromeWindow) {
    this._instances.delete(chromeWindow);
  }
}

exports.MagnifierManager = MagnifierManager;

function Magnifier(chromeWindow) {
  this.onMouseMove = this.onMouseMove.bind(this);
  this.onMouseDown = this.onMouseDown.bind(this);
  this.onKeyDown = this.onKeyDown.bind(this);

  this.chromeWindow = chromeWindow;
  this.chromeDocument = chromeWindow.document;
  this.dragging = true;
  this.popupSet = this.chromeDocument.querySelector("#mainPopupSet");

  let zoom = Services.prefs.getIntPref(ZOOM_PREF);
  this.zoomWindow = {
    x: 0,          // the left coordinate of the center of the inspected region
    y: 0,          // the top coordinate of the center of the inspected region
    width: 1,      // width of canvas to draw zoomed area onto
    height: 1,     // height of canvas
    zoom: zoom     // zoom level - integer, minimum is 2
  };

  this.format = Services.prefs.getCharPref(FORMAT_PREF);

  EventEmitter.decorate(this);
}

Magnifier.prototype = {
  /**
   * The number of cells (blown-up pixels) per direction in the grid.
   */
  get cellsWide() {
    let { width, zoom } = this.zoomWindow;

    // Canvas will render whole "pixels" (cells) only, and an even
    // number at that. Round up to the nearest even number of pixels.
    let cellsWide = Math.ceil(width / zoom)
    cellsWide += cellsWide % 2;

    return cellsWide;
  },

  /**
   * Size of each cell (blown-up pixel) in the grid.
   */
  get cellSize() {
    return this.zoomWindow.width / this.cellsWide;
  },

  /**
   * Get index of cell in the center of the grid.
   */
  get centerCell() {
    return Math.floor(this.cellsWide / 2);
  },

  /**
   * Get color of center cell in the grid.
   */
  get centerColor() {
    let x = y = (this.centerCell * this.cellSize) + (this.cellSize / 2);
    let rgb = this.ctx.getImageData(x, y, 1, 1).data;
    return new CssColor("rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")");
  },

  toggle: function() {
    if (this._panel) {
      this.destroy();
    }
    else {
      this.open();
    }
  },

  open: function() {
    this._panel = this.buildPanel();

    this.addListeners();
    this.popupSet.appendChild(this._panel);

    this._panel.openPopup();
  },

  destroy: function() {
    if (this._panel) {
      this.popupSet.removeChild(this._panel);
      this._panel = null;
    }
    this.removeListeners();
    this.destroyOutline();

    this.emit("destroy");
  },

  buildPanel: function() {
    let panel = this.chromeDocument.createElement("panel");
    panel.id = "devtools-magnifier-indication-panel";
    panel.setAttribute("noautofocus", true);
    panel.setAttribute("noautohide", true);
    panel.setAttribute("backdrag", true);
    panel.setAttribute("level", "floating");
    panel.setAttribute("titlebar", "normal");
    panel.setAttribute("close", true);
    panel.setAttribute("style", PANEL_STYLE);

    panel.addEventListener("popuphidden", (e) => {
      if (e.target === panel) {
        this.destroy();
      }
    });

    let iframe = this.iframe = this.chromeDocument.createElementNS(XULNS, "iframe");
    iframe.addEventListener("load", this.frameLoaded.bind(this), true);
    iframe.setAttribute("flex", "1");
    iframe.setAttribute("src", MAGNIFIER_URL);

    panel.appendChild(iframe);

    return panel;
  },

  frameLoaded: function() {
    this.iframeDocument =  this.iframe.contentDocument;
    this.canvas = this.iframeDocument.querySelector("#canvas");
    this.ctx = this.canvas.getContext("2d");
    this.canvasContainer = this.iframeDocument.querySelector("#canvas-container")
    this.zoomLevel = this.iframeDocument.querySelector("#zoom-level");
    this.colorLabel = this.iframeDocument.querySelector("#color-text-preview");
    this.colorPreview = this.iframeDocument.querySelector("#color-preview");
    this.colorValues = this.iframeDocument.querySelector("#color-value-list");
    this.toggleButton = this.iframeDocument.querySelector("#toggle-button");
    this.canvasOverflow = this.iframeDocument.querySelector("#canvas-overflow");
    this.copyButton = this.iframeDocument.querySelector("#copy-button");
    let computedOverflowStyle =  this.iframeDocument.defaultView.getComputedStyle(this.canvasOverflow);

    this.zoomWindow.width = parseInt(computedOverflowStyle.getPropertyValue("width"), 10);
    this.zoomWindow.height = parseInt(computedOverflowStyle.getPropertyValue("height"), 10);

    this.zoomLevel.value = this.zoomWindow.zoom;

    this.addPanelListeners();

    this.drawWindow();
  },

  addPanelListeners: function() {
    this.iframe.contentWindow.addEventListener("click", this.iframe.focus,
                                               false);

    this.toggleButton.addEventListener("command",
                           this.toggleDragging.bind(this), false);

    this.colorValues.addEventListener("command", () => {
      this.format = this.colorValues.selectedItem.getAttribute("format");
      Services.prefs.setCharPref(FORMAT_PREF, this.format);

      this.populateColorValues();
    }, false);

    this.canvas.addEventListener("click", this.onCellClick.bind(this));

    this.iframeDocument.addEventListener("keydown", this.maybeCopy.bind(this));
    this.iframeDocument.addEventListener("keydown", this.onKeyDown);

    this.zoomLevel.addEventListener("change", this.onZoomChange.bind(this));

    this.copyButton.addEventListener("command", this.doCopy.bind(this));

    let closeCmd = this.iframeDocument.getElementById("magnifier-cmd-close");
    closeCmd.addEventListener("command", this.destroy.bind(this), true);
  },

  addListeners: function() {
    this.chromeDocument.addEventListener("mousemove", this.onMouseMove);
    this.chromeDocument.addEventListener("mousedown", this.onMouseDown);
  },

  removeListeners: function() {
    this.chromeDocument.removeEventListener("mousemove", this.onMouseMove);
    this.chromeDocument.removeEventListener("mousedown", this.onMouseDown);
  },

  onMouseMove: function(event) {
    if (this.dragging && this._panel) {
      let x = event.screenX - this.chromeWindow.screenX;

      // FIXME: Why do we need 20px offset here?
      // console.log(this.chromeWindow.getComputedStyle(this.chromeDocument.querySelector("window")));

      let y = event.screenY - this.chromeWindow.screenY - 20;
      this.moveRegion(x, y);
    }
  },

  onMouseDown: function(event) {
    if (event.target.ownerDocument === this.iframeDocument
        || !this._panel || !this.dragging) {
      return;
    }

    this.toggleDragging(false);

    event.preventDefault();
    event.stopPropagation();

    if (event.which === 3) {
      this.doCopy(() => {
        this.destroy();
      });
    }
  },

  doCopy: function(cb) {
    Services.appShell.hiddenDOMWindow.clearTimeout(this.copyTimeout);
    clipboardHelper.copyString(this.colorValues.value);

    this.copyButton.textContent = this.copyButton.getAttribute("data-copied");
    this.copyButton.classList.add("highlight");
    this.copyTimeout = Services.appShell.hiddenDOMWindow.setTimeout(() => {
      this.copyButton.textContent = this.copyButton.getAttribute("data-copy");
      this.copyButton.classList.remove("highlight");

      if (cb && cb.apply) {
        cb();
      }
    }, 750);
  },

  maybeCopy: function(event) {
    if (event.metaKey && event.keyCode === event.DOM_VK_C) {
      this.doCopy();
    }
  },

  onKeyDown: function(event) {
    let offsetX = 0;
    let offsetY = 0;
    let modifier = 1;

    if (event.keyCode === event.DOM_VK_LEFT) {
      offsetX = -1;
    }
    if (event.keyCode === event.DOM_VK_RIGHT) {
      offsetX = 1;
    }
    if (event.keyCode === event.DOM_VK_UP) {
      offsetY = -1;
    }
    if (event.keyCode === event.DOM_VK_DOWN) {
      offsetY = 1;
    }
    if (event.shiftKey) {
      modifier = 10;
    }

    offsetY *= modifier;
    offsetX *= modifier;

    if (offsetX !== 0 || offsetY !== 0) {
      this.moveBy(offsetX, offsetY);
      event.preventDefault();
    }
  },

  onCellClick: function(event) {
    let rect = this.canvas.getBoundingClientRect();
    let x = (event.clientX - rect.left);
    let y = (event.clientY - rect.top);

    let cellX = Math.floor(x / this.cellSize);
    let cellY = Math.floor(y / this.cellSize);

    let offsetX = cellX - this.centerCell;
    let offsetY = cellY - this.centerCell;

    this.moveBy(offsetX, offsetY);
  },

  moveBy: function(offsetX=0, offsetY=0) {
    this.zoomWindow.x += offsetX;
    this.zoomWindow.y += offsetY;

    this.drawWindow();
  },

  onZoomChange: function() {
    this.zoomWindow.zoom = this.zoomLevel.value;

    let label = this.iframeDocument.querySelector("#zoom-level-value");
    label.value = this.zoomLevel.value + "x";

    Services.prefs.setIntPref(ZOOM_PREF, this.zoomWindow.zoom);

    this.drawWindow();
  },

  toggleDragging: function(mode) {
    if (mode === false) {
      this.dragging = false;
    }
    else if (mode === true) {
      this.dragging = true;
    }
    else {
      this.dragging = !this.dragging;
    }

    this.toggleButton.checked = this.dragging;
  },

  moveRegion: function(x, y) {
    this.zoomWindow.x = x;
    this.zoomWindow.y = y;

    this.drawWindow();
  },

  drawWindow: function() {
    let { width, height, x, y, zoom } = this.zoomWindow;

    this.canvas.width = width;
    this.canvas.height = height;

    let drawY = y - (height / 2);
    let drawX = x - (width / 2);

    this.hideOutline();

    this.ctx.mozImageSmoothingEnabled = false;

    this.ctx.drawWindow(this.chromeWindow, drawX, drawY, width, height, "white");

    this.moveOutline(x, y);

    if (zoom > 1) {
      let zoomedWidth = width / zoom;
      let zoomedHeight = height / zoom;
      let sx = (width - zoomedWidth) / 2;
      let sy = (height - zoomedHeight) / 2;
      let sw = zoomedWidth;
      let sh = zoomedHeight;
      let dx = 0;
      let dy = 0;
      let dw = width;
      let dh = height;

      this.ctx.drawImage(this.canvas, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    this.iframe.focus();

    this.colorPreview.style.backgroundColor = this.centerColor.hex;
    this.populateColorValues();

    if (this.zoomWindow.zoom > 2) {
      // grid at 2x is too busy
      this.drawGrid();
    }
    this.drawCrosshair();
  },

  drawGrid: function() {
    let { width, height, zoom } = this.zoomWindow;

    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "rgba(0, 0, 0, .05)";

    for (let i = 0; i < width; i += this.cellSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(i - .5, 0);
      this.ctx.lineTo(i - .5, height);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(0, i - .5);
      this.ctx.lineTo(width, i - .5);
      this.ctx.stroke();
    }
  },

  drawCrosshair: function() {
    let x = y = this.centerCell * this.cellSize;

    this.ctx.lineWidth = 1;
    this.ctx.lineJoin = 'miter';
    this.ctx.strokeStyle = "rgba(0, 0, 0, 1)";
    this.ctx.strokeRect(x - 1.5, y - 1.5, this.cellSize + 2, this.cellSize + 2);

    this.ctx.strokeStyle = "rgba(255, 255, 255, 1)";
    this.ctx.strokeRect(x - 0.5, y - 0.5, this.cellSize, this.cellSize);
  },

  populateColorValues: function() {
    let color = this.centerColor;

    for (let format of ["rgb", "hsl", "hex"]) {
      let item = this.iframeDocument.getElementById(format + "-value");
      item.value = item.label = color[format];
    }

    this.colorValues.value = color[this.format];
  },

  createOutline: function() {
    this.outlineBox = this.chromeDocument.createElement("box");
    this.outlineBox.setAttribute("style", OUTLINE_STYLE);

    this.chromeDocument.documentElement.appendChild(this.outlineBox);
  },

  destroyOutline: function() {
    if (this.outlineBox) {
      this.chromeDocument.documentElement.removeChild(this.outlineBox);
      this.outlineBox = null;
    }
  },

  hideOutline: function() {
    if (this.outlineBox) {
      this.outlineBox.style.display = "none";
    }
  },

  showOutline: function() {
    if (this.outlineBox) {
      this.outlineBox.style.display = "block";
    }
  },

  moveOutline: function(x, y) {
    if (!this.outlineBox) {
      this.createOutline();
    }
    this.showOutline();

    let width = this.zoomWindow.width / this.zoomWindow.zoom;
    let height = this.zoomWindow.height / this.zoomWindow.zoom;

    x = x - width / 2;
    y = y - height / 2;

    this.outlineBox.style.left = (x - 1)+ "px";
    this.outlineBox.style.top = (y - 1) + "px";

    this.outlineBox.style.width = (width + 2) + "px";
    this.outlineBox.style.height = (height + 2) + "px";
  },

  selectPreviewText: function() {
    //TODO: this doesn't work for some reason right now.
    var range = this.chromeDocument.createRange();
    range.setStartBefore(this.colorLabel.firstChild);
    range.setEndAfter(this.colorLabel.lastChild);
    var sel = this.chromeWindow.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}