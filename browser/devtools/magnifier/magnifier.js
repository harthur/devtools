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

  this.popupSet = this.chromeDocument.querySelector("#mainPopupSet");
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



    return panel;
  },

  drawWindow: function() {
    this.canvas = this.iframe.contentDocument.getElementById("canvas");

    console.log(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    let width = this.chromeWindow.innerWidth;
    let height = this.chromeWindow.innerHeight;
    let x = 0;
    let y = 0;

    this.canvas.width = width;
    this.canvas.height = height;

    console.log("Drawing window", this.chromeWindow, this.ctx, height, width);
    debugger;



    this.ctx.drawWindow(this.chromeWindow, x, y, width, height, "white");
  }
}