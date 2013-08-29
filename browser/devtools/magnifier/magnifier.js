const {Cc, Ci, Cu} = require("chrome");

Cu.import("resource://gre/modules/Services.jsm");
let { CssColor } = require("devtools/magnifier/CSSColor");

loader.lazyGetter(this, "gDevTools",
  () => Cu.import("resource:///modules/devtools/gDevTools.jsm", {}).gDevTools);

const PANEL_STYLE = "background: rgba(0,100,150,0.1);" +
                    "height: 275px;width:300px";

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
  let format = "rgb";
  try {
    zoom = Services.prefs.getIntPref(ZOOM_PREF);
    format = Services.prefs.getCharPref(FORMAT_PREF);
  }
  catch (e)  {
  }

  this.dragging = true;
  this.popupSet = this.chromeDocument.querySelector("#mainPopupSet");
  this.zoomWindow = {
    x: 0,
    y: 0,
    cx: null,
    cy: null,
    width: 200,
    height: 200,
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
    this.popupSet.appendChild(this._panel);

    this._panel.openPopup();
  },

  destroy: function() {
    if (this._panel) {
      this._panel.hidePopup();
      this.popupSet.removeChild(this._panel);

      this._panel = null;
    }
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

    this.chromeDocument.addEventListener("mousemove", (e) => {
      if (this.dragging && this._panel) {
        let x =  e.screenX -  this.chromeWindow.screenX;
        let y =  e.screenY -  this.chromeWindow.screenY - 20;
        this.moveRegion(x, y);
      }
    });
    this.chromeDocument.addEventListener("mousedown", (e) => {
      if (e.target.ownerDocument === this.iframeDocument || !this._panel) {
        return;
      }

      this.dragging = !this.dragging;

      e.preventDefault();
      e.stopPropagation();
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
    this.colorFormatOptions = this.iframeDocument.querySelector("#colorformat-list");

    this.zoomLevel.value = this.zoomWindow.zoom;
    this.drawWindow();

    this.colorFormatOptions.addEventListener("command", () => {
      this.zoomWindow.format = this.colorFormatOptions.value;

      console.log("HERE", this.zoomWindow.format, Services.prefs,  this.zoomWindow.format);

      Services.prefs.setCharPref(FORMAT_PREF, this.zoomWindow.format);

      this.drawWindow();
    }, false);

    this.zoomLevel.addEventListener("change", this.onZoomChange.bind(this));
  },

  onZoomChange: function() {
    this.zoomWindow.zoom = this.zoomLevel.value;

    Services.prefs.setIntPref(ZOOM_PREF, this.zoomWindow.zoom);

    this.hideOutline();

    this.drawWindow();

    this.moveOutline(this.zoomWindow.x, this.zoomWindow.y);
  },

  moveRegion: function(x, y) {
    this.zoomWindow.x = x;
    this.zoomWindow.y = y;

    // don't draw outline in zoom
    this.hideOutline();

    this.drawWindow();

    this.moveOutline(x, y);
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

    // let csswidth = (width * zoom) + "px";
    // let cssheight = (height * zoom) + "px";
    //this.canvas.style.width = csswidth;
    //this.canvas.style.height = cssheight;

    let drawY = y - (height / 2);
    let drawX = x - (width / 2);

    this.ctx.drawWindow(this.chromeWindow, drawX, drawY, width, height, "white");

    let rgb = this.ctx.getImageData(Math.floor(width/2), Math.floor(height/2), 1, 1).data;

    // console.log("HERE", this.chromeWindow.getComputedStyle, this.chromeDocument.querySelector("window"));
    // console.log(this.chromeWindow.getComputedStyle(this.chromeDocument.querySelector("window")));

    //.getPropertyValue("margin-left"));
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
      //console.log(sx, sy, sw, sh, dx, dy, dw, dh);
      this.ctx.drawImage(this.canvas, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    let color = new CssColor("rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")");
    this.colorPreview.style.backgroundColor = color.hex;

    this.colorLabel.textContent = {
      "hex": color.hex,
      "hsl": color.hsl,
      "rgb": color.rgb
    }[this.zoomWindow.format];

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