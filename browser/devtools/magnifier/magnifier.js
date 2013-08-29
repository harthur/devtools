const {Cc, Ci, Cu} = require("chrome");

Cu.import("resource://gre/modules/Services.jsm");
let { CssColor } = require("devtools/magnifier/CSSColor");

loader.lazyGetter(this, "gDevTools",
  () => Cu.import("resource:///modules/devtools/gDevTools.jsm", {}).gDevTools);

const PANEL_STYLE = "background:rgba(0,100,150,0.1);" +
                    "height:240px;width:240px";

const XULNS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const MAGNIFIER_URL = "chrome://browser/content/devtools/magnifier.xul";
const ZOOM_PREF    = "devtools.magnifier.zoom";

let MagnifierManager = {
  _instances: new WeakMap(),

  instanceForWindow: function(chromeWindow) {
    if (this._instances.has(chromeWindow)) {
      return this._instances.get(chromeWindow);
    } else {
      let magnifier = new Magnifier(chromeWindow);
      this._instances.set(chromeWindow, magnifier);
      return magnifier;
    }
  }
}

exports.MagnifierManager = MagnifierManager;

function Magnifier(chromeWindow) {
  this.chromeWindow = chromeWindow;
  this.chromeDocument = chromeWindow.document;

  // TODO: actually use preferences that make sense here
  //this.docked = true;
  // this.position = {
  //   width: 100,
  //   height: 100
  // };
  //this.state = true;
  //this.zoomLevel = 2;
  //let gWidth = Math.floor(this.position.width / this.zoomLevel) + 1;
  //let gHeight = Math.floor(this.position.height / this.zoomLevel) + 1;
  //let gZoom = this.zoomLevel;

  let zoom = 1;
  try {
    zoom = Services.prefs.getIntPref(ZOOM_PREF);
  }
  catch (e) {

  }

  this.popupSet = this.chromeDocument.querySelector("#mainPopupSet");
  this.zoomWindow = {
    x: 0,
    y: 0,
    cx: null,
    cy: null,
    width: 50,
    height: 50,
    zoom: zoom,
  };

}

Magnifier.prototype = {
  toggle: function() {
    if (this._panel) {
      this.close();
    }
    else {
      this.open();
    }
  },

  open: function() {
    this._panel = this.buildPanel();
    this.popupSet.appendChild(this._panel);

    this._panel.openPopup();
  },

  close: function() {
    if (this._panel) {
      this._panel.hidePopup();
      this.popupSet.removeChild(this._panel);

      this._panel = null;
    }
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

    let iframe = this.iframe = this.chromeDocument.createElementNS(XULNS, "iframe");
    iframe.addEventListener("load", this.frameLoaded.bind(this), true);
    iframe.setAttribute("flex", "1");
    iframe.setAttribute("src", MAGNIFIER_URL);

    panel.appendChild(iframe);

    this.chromeDocument.addEventListener("mousemove", (e) => {
      this.moveRegion( e.screenX -  this.chromeWindow.screenX, e.screenY -  this.chromeWindow.screenY);
    });

    return panel;
  },

  frameLoaded: function() {
    this.iframeDocument =  this.iframe.contentDocument;

    this.canvas = this.iframeDocument.getElementById("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.zoomLevel = this.iframeDocument.querySelector("#zoom-level");
    this.colorLabel = this.iframeDocument.querySelector("#color-text-preview");
    this.colorPreview = this.iframeDocument.querySelector("#color-preview");

    this.zoomLevel.value = this.zoomWindow.zoom;
    this.drawWindow();


    this.zoomLevel.addEventListener("change", () => {
      this.zoomWindow.zoom = this.zoomLevel.value;

      Services.prefs.setIntPref(ZOOM_PREF, this.zoomWindow.zoom);

      this.drawWindow();
    });

  },

  moveRegion: function(x, y) {
    this.zoomWindow.x = x;
    this.zoomWindow.y = y;
    this.drawWindow();
  },

  drawOutline: function(x, y) {
    let stack = this.browser.parentNode;
    this.win = this.browser.contentWindow;

    this.outlineStack = this.chromeDocument.createElement("stack");
    this.outlineStack.className = "devtools-magnifier-stack";

    this.outline = this.chromeDocument.createElement("box");
    this.outline.className = "devtools-magnifier-outline";

    let outlineContainer = this.chromeDoc.createElement("box");
    outlineContainer.appendChild(this.outline);
    outlineContainer.className = "devtools-magnifier-outline-container";

    this.outlineStack.appendChild(outlineContainer);
  },

  drawWindow: function() {
    let { width, height, x, y, zoom } = this.zoomWindow;

    let csswidth = (width * zoom) + "px";
    let cssheight = (height * zoom) + "px";

    this.canvas.width = width;
    this.canvas.height = height;

    this.canvas.style.width = csswidth;
    this.canvas.style.height = cssheight;

    let drawY = y - height;
    let drawX = x - (width / 2);

    this.ctx.drawWindow(this.chromeWindow, drawX, drawY, width, height, "white");

    let rgb = this.ctx.getImageData(Math.floor(width/2), Math.floor(height/2), 1, 1).data;

    let color = new CssColor("rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")");
    this.colorLabel.textContent = color.hex;
    this.colorPreview.style.backgroundColor = color.hex;

    this.selectPreviewText();
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