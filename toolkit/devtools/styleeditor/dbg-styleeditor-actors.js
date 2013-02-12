/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

/**
 * Creates a StyleEditorActor. StyleEditorActor provides remote access to the
 * built-in style editor module.
 */
function StyleEditorActor(aConnection, aParentActor)
{
  this.conn = aConnection;
  this._onMutations = this._onMutations.bind(this);

  if (aParentActor instanceof BrowserTabActor &&
      aParentActor.browser instanceof Ci.nsIDOMWindow) {
    this._window = aParentActor.browser;
  }
  else if (aParentActor instanceof BrowserTabActor &&
           aParentActor.browser instanceof Ci.nsIDOMElement) {
    this._window = aParentActor.browser.contentWindow;
  }
  else {
    this._window = Services.wm.getMostRecentWindow("navigator:browser");
  }

  this._actorPool = new ActorPool(this.conn);
  this.conn.addActorPool(this._actorPool);
}

StyleEditorActor.prototype = {
  /**
   * Actor pool for all of the actors we send to the client.
   */
  _actorPool: null,

  /**
   * The debugger server connection instance.
   */
  conn: null,

  /**
   * The content window we work with.
   */
  get window() this._window,

  /**
   * The current content document of the window we work with.
   */
  get doc() this._window.document,

  _window: null,

  actorPrefix: "styleEditor",

  grip: function IA_grip()
  {
    return { actor: this.actorID };
  },

  /**
   * Destroy the current StyleEditorActor instance.
   */
  disconnect: function SEA_disconnect()
  {
    if (this._observer) {
      this._observer.disconnect();
      delete this._observer;
    }

    this.conn.removeActorPool(this.actorPool);
    this._actorPool = null;
    this.conn = this._window = null;
  },

  releaseActor: function SEA_releaseActor(aActor)
  {
    if (this._actorPool) {
      this._actorPool.removeActor(aActor.actorID);
    }
  },

  onGetStyleSheets: function SEA_onGetStyleSheets() {
    let styleSheets = [];

    for (let i = 0; i < this.doc.styleSheets.length; ++i) {
      let styleSheet = this.doc.styleSheets[i];
      let actor = this._createStyleSheetActor(styleSheet);

      styleSheets.push(actor.form());
    }
    this._attachMutationObserver();

    return { "styleSheets": styleSheets };
  },

  _createStyleSheetActor: function SEA_createStyleSheetActor(aStyleSheet)
  {
    let actor = new StyleSheetActor(aStyleSheet, this);
    this._actorPool.addActor(actor);
    return actor;
  },

  _attachMutationObserver: function SEA_attachMutationObserver() {
    dump("HEATHER: attaching _observer" +  + "\n");
    this._observer = new this.window.MutationObserver(this._onMutations);
    this._observer.observe(this.window.document.getElementsByTagName("head")[0], {
      childList: true
    });

    dump("HEATHER: attached _observer" + "\n");
  },

  _onMutations: function DWA_onMutations(mutations)
  {
    let styleSheets = [];
    for (let mutation of mutations) {
      if (mutation.type != "childList") {
        continue;
      }
      let target = mutation.target;
      for (let node of mutation.addedNodes) {
        if (node.localName == "style" ||
            (node.localName == "link" &&
             node.rel == "stylesheet")) {
          let actor = this._createStyleSheetActor(node.sheet);
          styleSheets.push(actor.form());
        }
      }
    }

    if (styleSheets.length) {
      this.conn.send({
        from: this.actorID,
        type: "styleSheetAdded",
        styleSheets: styleSheets
      });
    }
  }
};

/**
 * The request types this actor can handle.
 */
StyleEditorActor.prototype.requestTypes = {
  "getStyleSheets": StyleEditorActor.prototype.onGetStyleSheets
};


function StyleSheetActor(aStyleSheet, aParentActor) {
  this.styleSheet = aStyleSheet;
  this.parentActor = aParentActor;
}

StyleSheetActor.prototype = {
  actorPrefix: "stylesheet",

  form: function SSA_form() {
    // actorID is set when this actor is added to a pool
    let form = {
      actor: this.actorID,
      href: this.styleSheet.href,
      disabled: this.styleSheet.disabled,
      title: this.styleSheet.title
    }

    let rules = this.styleSheet.cssRules;
    for (let i = 0; i < rules.length; i++) {
      let rule = rules[i];
    }

    return form;
  },

  toString: function SSA_toString() {
    return "[StyleSheetActor " + this.actorID + "]";
  },

  disconnect: function SSA_disconnect() {
    this.parentActor.releaseActor(this);
  },

  onGetDisabled: function(aRequest) {
    return { disabled: this.styleSheet.disabled };
  },

  onSetDisabled: function(aRequest) {
    this.styleSheet.disabled = aRequest.disabled;
  },

  onUpdate: function(aRequest) {
    DOMUtils.parseStyleSheet(this.styleSheet, aRequest.text);
  }
}

StyleSheetActor.prototype.requestTypes = {
  "getDisabled": StyleSheetActor.prototype.onGetDisabled,
  "setDisabled": StyleSheetActor.prototype.onSetDisabled,
  "update": StyleSheetActor.prototype.onUpdate
};


XPCOMUtils.defineLazyGetter(this, "DOMUtils", function () {
  return Cc["@mozilla.org/inspector/dom-utils;1"].getService(Ci.inIDOMUtils);
});
