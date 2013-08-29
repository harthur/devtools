const {Cu} = require("chrome");

loader.lazyGetter(this, "gDevTools",
  () => Cu.import("resource:///modules/devtools/gDevTools.jsm", {}).gDevTools);

const PANEL_STYLE = "background:rgba(0,100,150,0.1);" +
                    "height:240px;width:240px";

const XULNS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const MAGNIFIER_URL = "chrome://browser/content/devtools/magnifier.xul";

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
  this.docked = true;
  this.position = {
    width: 100,
    height: 100
  };
  this.state = true;
  this.zoomLevel = 2;

  let gWidth = Math.floor(this.position.width / this.zoomLevel) + 1;
  let gHeight = Math.floor(this.position.height / this.zoomLevel) + 1;
  let gZoom = this.zoomLevel;

  this.popupSet = this.chromeDocument.querySelector("#mainPopupSet");
  this.zoomWindow = {
    x: 0,
    y: 0,
    cx: null,
    cy: null,
    width: gWidth,
    height: gHeight,
    zoom: gZoom,
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
    iframe.addEventListener("load", this.drawWindow.bind(this), true);
    iframe.setAttribute("flex", "1");
    iframe.setAttribute("src", MAGNIFIER_URL);

    panel.appendChild(iframe);


    this.chromeDocument.addEventListener("mousemove", (e) => {
      // console.log(e);
      // console.log(e.pageX, e.pageY);
      this.moveRegion(e.pageX, e.pageY);
    });

    return panel;
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
  }

  drawWindow: function() {
    this.canvas = this.iframe.contentDocument.getElementById("canvas");

    this.ctx = this.canvas.getContext("2d");

    let width = this.zoomWindow.width;
    let height = this.zoomWindow.height;

    let x = this.zoomWindow.x;
    let y = this.zoomWindow.y;

    this.canvas.width = width;
    this.canvas.height = height;

    this.ctx.drawWindow(this.chromeWindow, x, y, width, height, "white");
  }
}