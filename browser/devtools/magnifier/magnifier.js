loader.lazyGetter(this, "gDevTools",
  () => Cu.import("resource:///modules/devtools/gDevTools.jsm", {}).gDevTools);

const PANEL_STYLE = "-moz-appearance: none !important;background:rgba(0,100,150,0.1);" +
                    "border:3px solid #36a;border-radius:5px;height:240px;width:240px";

let MagnifierManager = {
  _instances: new WeakMap(),

  instanceForTarget: function(target, chromeDocument) {
    if (this._instances.has(target)) {
      return this._instances.get(target);
    } else {
      let magnifier = new Magnifier(target, chromeDocument);
      this._instances.set(target, magnifier);
      return magnifier;
    }
  }
}

exports.MagnifierManager = MagnifierManager;


function Magnifier(target, chromeDocument) {
  this.target = target;
  this.chromeDocument = chromeDocument;

  this.popupSet = chromeDocument.querySelector("#mainPopupSet");
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

    let anchor = gDevTools.getToolbox(this.target);
    this._panel.openPopup(anchor, "before_start");
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

    return panel;
  }
}