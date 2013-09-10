const {Cc, Ci, Cu} = require("chrome");

Cu.import("resource://gre/modules/Services.jsm");
let { CssColor } = require("devtools/magnifier/CSSColor");

loader.lazyGetter(this, "gDevTools",
  () => Cu.import("resource:///modules/devtools/gDevTools.jsm", {}).gDevTools);

loader.lazyGetter(this, "clipboardHelper", function() {
  return Cc["@mozilla.org/widget/clipboardhelper;1"].
    getService(Ci.nsIClipboardHelper);
});

const PANEL_STYLE = "background: rgba(0,100,150,0.1);" +
                    "height: 275px;width:350px";

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
      this._instances.delete(chromeWindow);

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
    return magnifier;
  }
}

exports.MagnifierManager = MagnifierManager;

function Magnifier(chromeWindow) {
  let zoom = 2;
  let format = "rgb";
  try {
    zoom = Services.prefs.getIntPref(ZOOM_PREF);
    format = Services.prefs.getCharPref(FORMAT_PREF);
  }
  catch (e)  {
    // TODO: why would this happen?
  }
  this.format = format;

  this.onMouseMove = this.onMouseMove.bind(this);
  this.onMouseDown = this.onMouseDown.bind(this);

  this.chromeWindow = chromeWindow;
  this.chromeDocument = chromeWindow.document;
  this.dragging = true;
  this.popupSet = this.chromeDocument.querySelector("#mainPopupSet");
  this.zoomWindow = {
    x: 0,          // the left coordinate of the center of the inspected region
    y: 0,          // the top coordinate of the center of the inspected region
    width: 1,      // width of canvas to draw zoomed area onto
    height: 1,     // height of canvas
    zoom: zoom     // zoom level - integer, minimum is 2
  };
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
      this._panel.hidePopup();
      this.popupSet.removeChild(this._panel);

      this._panel = null;
    }
    this.removeListeners();
    this.destroyOutline();
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
    this.colorFormatOptions = this.iframeDocument.querySelector("#colorformat-list");
    this.toggleButton = this.iframeDocument.querySelector("#toggle-button");
    this.canvasOverflow = this.iframeDocument.querySelector("#canvas-overflow");
    let computedOverflowStyle =  this.iframeDocument.defaultView.getComputedStyle(this.canvasOverflow);

    this.zoomWindow.width = parseInt(computedOverflowStyle.getPropertyValue("width"), 10);
    this.zoomWindow.height = parseInt(computedOverflowStyle.getPropertyValue("height"), 10);

    this.zoomLevel.value = this.zoomWindow.zoom;
    this.colorFormatOptions.value = this.format;

    this.addPanelListeners();

    this.drawWindow();
  },

  addPanelListeners: function() {
    // TODO: This doesn't fire until after a dropdown is selected
    // this.iframe.contentWindow.addEventListener("keydown", (e) => {
    //   this.nudge("left", 10);
    // }, true);

    this.toggleButton.addEventListener("command",
                           this.toggleDragging.bind(this), false);

    this.colorFormatOptions.addEventListener("command", () => {
      this.format = this.colorFormatOptions.value;
      Services.prefs.setCharPref(FORMAT_PREF, this.format);

      this.populateColorLabel();
    }, false);

    this.canvas.addEventListener("click", this.onCellClick.bind(this));

    this.zoomLevel.addEventListener("change", this.onZoomChange.bind(this));

    let copyButton = this.iframeDocument.querySelector("#copy-button");
    copyButton.addEventListener("command", () => {
      clipboardHelper.copyString(this.colorLabel.textContent);
    }, false);
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

    this.drawGrid();
    this.drawCrosshair();

    this.colorPreview.style.backgroundColor = this.centerColor.hex;
    this.populateColorLabel();
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

  populateColorLabel: function() {
    let color = this.centerColor;

    this.colorLabel.textContent = {
      "hex": color.hex,
      "hsl": color.hsl,
      "rgb": color.rgb
    }[this.format];
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