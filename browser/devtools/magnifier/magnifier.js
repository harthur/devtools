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

  this.onMouseMove = this.onMouseMove.bind(this);
  this.onMouseDown = this.onMouseDown.bind(this);

  this.chromeWindow = chromeWindow;
  this.chromeDocument = chromeWindow.document;
  this.dragging = true;
  this.popupSet = this.chromeDocument.querySelector("#mainPopupSet");
  this.zoomWindow = {
    x: 0,
    y: 0,
    cx: null,
    cy: null,
    width: 1,
    height: 1,
    zoom: zoom,
    format: format
  };
}

Magnifier.prototype = {
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
    this.toggleMagnifier = this.iframeDocument.querySelector("#toggle-magnifier");
    this.canvasOverflow = this.iframeDocument.querySelector("#canvas-overflow");
    let computedOverflowStyle =  this.iframeDocument.defaultView.getComputedStyle(this.canvasOverflow);

    this.zoomWindow.width = parseInt(computedOverflowStyle.getPropertyValue("width"), 10);
    this.zoomWindow.height = parseInt(computedOverflowStyle.getPropertyValue("height"), 10);

    this.zoomLevel.value = this.zoomWindow.zoom;
    this.colorFormatOptions.value = this.zoomWindow.format;
    this.drawWindow();


    // TODO: This doesn't fire until after a dropdown is selected
    // this.iframe.contentWindow.addEventListener("keydown", (e) => {
    //   this.nudge("left", 10);
    // }, true);

    this.toggleMagnifier.addEventListener("command", this.toggleDragging.bind(this), false);
    this.colorFormatOptions.addEventListener("command", () => {
      this.zoomWindow.format = this.colorFormatOptions.value;

      Services.prefs.setCharPref(FORMAT_PREF, this.zoomWindow.format);

      this.drawWindow();
    }, false);

    this.zoomLevel.addEventListener("change", this.onZoomChange.bind(this));

    this.iframeDocument.querySelector("#copy-clipboard").addEventListener("command", () => {
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

  onZoomChange: function() {
    this.zoomWindow.zoom = this.zoomLevel.value;

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

    this.toggleMagnifier.checked = this.dragging;
  },

  nudge: function(direction, amount) {
    amount = amount || 1;
    let {x, y} = this.zoomWindow;
    if (direction === "left") {
      x = x - amount;
    }
    if (direction === "right") {
      x = x + amount;
    }
    if (direction === "up") {
      y = y + amount;
    }
    if (direction === "down") {
      y = y - amount;
    }

    this.moveRegion(x, y);

  },

  moveRegion: function(x, y) {
    this.zoomWindow.x = x;
    this.zoomWindow.y = y;

    this.drawWindow();
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

  drawWindow: function() {
    let { width, height, x, y, zoom } = this.zoomWindow;

    this.canvas.width = width;
    this.canvas.height = height;

    let drawY = y - (height / 2);
    let drawX = x - (width / 2);

    this.hideOutline();

    this.ctx.mozImageSmoothingEnabled = false;

    this.ctx.drawWindow(this.chromeWindow, drawX, drawY, width, height, "white");
    let rgb = this.ctx.getImageData(Math.floor(width/2), Math.floor(height/2), 1, 1).data;

    // Draw crosshair
    this.ctx.strokeStyle = "rgba(0, 0, 0, .5)";
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(Math.round(width / 2) - .5, Math.round(height / 2) - .5, 2, 2);
    this.moveOutline(x, y);

    // Draw grid
    this.ctx.strokeStyle = "rgba(0, 0, 0, .05)";
    for (let i = 1; i < width; i+=2) {

      this.ctx.beginPath();
      this.ctx.moveTo(i + .5, 0);
      this.ctx.lineTo(i + .5, height);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(0, i + .5);
      this.ctx.lineTo(width, i + .5);
      this.ctx.stroke();

    }

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

      //this.canvasContainer.style.transform = "scale(" + zoom + ")";
    }

    let color = new CssColor("rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")");
    this.colorPreview.style.backgroundColor = color.hex;

    this.colorLabel.textContent = {
      "hex": color.hex,
      "hsl": color.hsl,
      "rgb": color.rgb
    }[this.zoomWindow.format];

    //this.selectPreviewText();
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