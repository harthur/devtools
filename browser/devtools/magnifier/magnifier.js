const {Cu} = require("chrome");

loader.lazyGetter(this, "gDevTools",
  () => Cu.import("resource:///modules/devtools/gDevTools.jsm", {}).gDevTools);

const PANEL_STYLE = "-moz-appearance: none !important;background:rgba(0,100,150,0.1);" +
                    "border:3px solid #36a;border-radius:5px;height:240px;width:240px";

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
    panel.setAttribute("titlebar", "Pixel Inspector");
    panel.setAttribute("style", PANEL_STYLE);

    let iframe = this.chromeDocument.createElementNS(XULNS, "iframe");
    iframe.setAttribute("flex", "1");
    iframe.setAttribute("src", MAGNIFIER_URL);
    panel.appendChild(iframe);

    return panel;
  }
}