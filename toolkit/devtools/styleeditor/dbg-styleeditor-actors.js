/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource:///modules/devtools/StyleEditorUtil.jsm");

const TRANSITION_CLASS = "moz-styleeditor-transitioning";
const TRANSITION_DURATION_MS = 500;
const TRANSITION_RULE = "\
:root.moz-styleeditor-transitioning, :root.moz-styleeditor-transitioning * {\
transition-duration: " + TRANSITION_DURATION_MS + "ms !important; \
transition-delay: 0ms !important;\
transition-timing-function: ease-out !important;\
transition-property: all !important;\
}";


/**
 * Creates a StyleEditorActor. StyleEditorActor provides remote access to the
 * built-in style editor module.
 */
function StyleEditorActor(aConnection, aParentActor)
{
  this.conn = aConnection;
  this._onDocumentLoaded = this._onDocumentLoaded.bind(this);
  this._onMutations = this._onMutations.bind(this);
  this._onSheetLoaded = this._onSheetLoaded.bind(this);

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
  get win() this._window,

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

  onAddLoadListener: function SEA_onAddLoadListen()
  {
    // Note: listening for load won't be necessary once
    // https://bugzilla.mozilla.org/show_bug.cgi?id=839103 is fixed
    if (this.doc.readyState == "complete") {
      this._onDocumentLoaded();
    }
    else {
      this.win.addEventListener("load", this._onDocumentLoaded, false);
    }
    return {};
  },

  onGetStyleSheets: function SEA_onGetStyleSheets()
  {
    let styleSheets = [];

    for (let i = 0; i < this.doc.styleSheets.length; ++i) {
      let styleSheet = this.doc.styleSheets[i];
      let actor = this._createStyleSheetActor(styleSheet);
      styleSheets.push(actor.form());
    }

    return { "styleSheets": styleSheets };
  },

  _onDocumentLoaded: function SEA_onDocumentLoaded(aEvent)
  {
    if (aEvent) {
      this.win.removeEventListener("load", this._onDocumentLoaded, false);
    }
    let styleSheets = [];

    for (let i = 0; i < this.doc.styleSheets.length; ++i) {
      let styleSheet = this.doc.styleSheets[i];
      let actor = this._createStyleSheetActor(styleSheet);
      styleSheets.push(actor.form());
    }

    // We need to attach mutation listeners right after fetching initial
    // sheets so that we don't miss any stylesheets being added.
    // this._attachMutationObserver();   // TODO: prevent duplicate with new/import

    if (styleSheets.length) {
      this._notifyStyleSheetsAdded(styleSheets);
    }
  },

  _notifyStyleSheetsAdded: function(styleSheets)
  {
    this.conn.send({
      from: this.actorID,
      type: "styleSheetsAdded",
      styleSheets: styleSheets
    });
  },

  _createStyleSheetActor: function(aStyleSheet, flags)
  {
    let actor = new StyleSheetActor(aStyleSheet, this, flags);
    this._actorPool.addActor(actor);
    return actor;
  },

  _attachMutationObserver: function SEA_attachMutationObserver() {
    this._observer = new this.win.MutationObserver(this._onMutations);
    this._observer.observe(this.win.document.documentElement, {
      childList: true,
      subtree: true
    });
  },

  _onMutations: function SEA_onMutations(mutations)
  {
    let styleSheets = [];
    for (let mutation of mutations) {
      if (mutation.type != "childList") {
        continue;
      }
      let target = mutation.target;
      for (let node of mutation.addedNodes) {
        if (node.localName == "style") {
          let actor = this._createStyleSheetActor(node.sheet);
          styleSheets.push(actor.form());
        }
        if (node.localName == "link" &&
            node.rel == "stylesheet") {
          node.addEventListener("load", this._onSheetLoaded, false);
        }
      }
    }

    if (styleSheets.length) {
      this._notifyStyleSheetsAdded(styleSheets);
    }
  },

  _onSheetLoaded: function(event) {
    let style = event.target;
    style.removeEventListener("load", this._onSheetLoaded, false);

    let actor = this._createStyleSheetActor(style.sheet);
    this._notifyStyleSheetsAdded([actor.form()]);
  },

  onNewStyleSheet: function SEA_newStyleSheet(request) {
    let parent = this.doc.documentElement;
    let style = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
    style.setAttribute("type", "text/css");

    let flags = ["new"];
    if (request.text) {
      flags.push("imported");
    }
    let onSheetLoaded = function(event) {
      style.removeEventListener("load", onSheetLoaded, false);

      let actor = this._createStyleSheetActor(style.sheet, flags);
      this._notifyStyleSheetsAdded([actor.form()]);
    }.bind(this);

    // if sheet has an @import, then it's loaded async
    style.addEventListener("load", onSheetLoaded, false);

    if (request.text) {
      style.appendChild(this.doc.createTextNode(request.text));
    }
    parent.appendChild(style);
  }
};

/**
 * The request types this actor can handle.
 */
StyleEditorActor.prototype.requestTypes = {
  "getStyleSheets": StyleEditorActor.prototype.onGetStyleSheets,
  "newStyleSheet": StyleEditorActor.prototype.onNewStyleSheet,
  "addLoadListener": StyleEditorActor.prototype.onAddLoadListener
};


function StyleSheetActor(aStyleSheet, aParentActor, flags) {
  this.styleSheet = aStyleSheet;
  this.parentActor = aParentActor;
  this._flags = flags || [];

  // text and index are unknown until source load
  this.text = null;
  this._styleSheetIndex = -1;

  this._onSourceLoad = this._onSourceLoad.bind(this);
}

StyleSheetActor.prototype = {
  actorPrefix: "stylesheet",

  toString: function() {
    return "[StyleSheetActor " + this.actorID + "]";
  },

  disconnect: function() {
    this.parentActor.releaseActor(this);
  },

  get win() {
    return this.parentActor._window;
  },

  get doc() {
    return this.win.document;
  },

  get isInline() {
    return !this.styleSheet.href;
  },

  get isNew() {
    return this._flags.indexOf("new") >= 0;
  },

  /**
   * Retrieve the index (order) of stylesheet in the document.
   *
   * @return number
   */
  get styleSheetIndex()
  {
    if (this._styleSheetIndex == -1) {
      for (let i = 0; i < this.doc.styleSheets.length; i++) {
        if (this.doc.styleSheets[i] == this.styleSheet) {
          this._styleSheetIndex = i;
          break;
        }
      }
    }
    return this._styleSheetIndex;
  },

  form: function SSA_form() {
    let form = {
      actor: this.actorID,  // actorID is set when this actor is added to a pool
      href: this.styleSheet.href,
      disabled: this.styleSheet.disabled,
      title: this.styleSheet.title,
      isInline: this.isInline,
      isNew: this.isNew,
      friendlyName: this._getFriendlyName(),
      text: this.text,
      styleSheetIndex: this.styleSheetIndex
    }

    // send a shallow copy of the sheet's cssRules
    form.cssRules = [];
    let rules = this.styleSheet.cssRules;
    for (let i = 0; i < rules.length; i++) {
      let rule = rules[i];
      form.cssRules.push({
        cssText: rule.cssText,
        type: rule.type
      });
    }

    return form;
  },

  onToggleDisabled: function(aRequest) {
    this.styleSheet.disabled = !this.styleSheet.disabled;
  },

  _onSourceLoad: function SSA_onSourceLoad(source)
  {
    this.text = source;

    this.conn.send({
      from: this.actorID,
      type: "sourceLoad-" + this.actorID,
      source: source
    });

    this._notifyPropertyChanged();
  },

  _notifyPropertyChanged: function()
  {
    this.conn.send({
      from: this.actorID,
      type: "propertyChange-" + this.actorID,
      form: this.form()
    })
  },

  onFetchSource: function() {
    if (!this.styleSheet.href) {
      // this is an inline <style> sheet
      let source = this.styleSheet.ownerNode.textContent;
      this._onSourceLoad(source);
      return;
    }

    let scheme = Services.io.extractScheme(this.styleSheet.href);
    switch (scheme) {
      case "file":
        this._styleSheetFilePath = this.styleSheet.href;
      case "chrome":
      case "resource":
        this._loadSourceFromFile(this.styleSheet.href);
        break;
      default:
        this._loadSourceFromCache(this.styleSheet.href);
        break;
    }
  },

  /**
   * Load source from a file or file-like resource.
   *
   * @param string href
   *        URL for the stylesheet.
   */
  _loadSourceFromFile: function SSA_loadSourceFromFile(href)
  {
    try {
      NetUtil.asyncFetch(href, function onFetch(stream, status) {
        if (!Components.isSuccessCode(status)) {
          return this._signalError(LOAD_ERROR);
        }
        let source = NetUtil.readInputStreamToString(stream, stream.available());
        aStream.close();
        this._onSourceLoad(source);
      }.bind(this));
    } catch (ex) {
      // TODO: implement error stuff
    }
  },

  /**
   * Load source from the HTTP cache.
   *
   * @param string href
   *        URL for the stylesheet.
   */
  _loadSourceFromCache: function SSA_loadSourceFromCache(href)
  {
    let channel = Services.io.newChannel(href, null, null);
    let chunks = [];
    let channelCharset = "";
    let streamListener = { // nsIStreamListener inherits nsIRequestObserver
      onStartRequest: function (aRequest, aContext, aStatusCode) {
        if (!Components.isSuccessCode(aStatusCode)) {
          return this._signalError(LOAD_ERROR);
        }
      }.bind(this),
      onDataAvailable: function (aRequest, aContext, aStream, aOffset, aCount) {
        let channel = aRequest.QueryInterface(Ci.nsIChannel);
        if (!channelCharset) {
          channelCharset = channel.contentCharset;
        }
        chunks.push(NetUtil.readInputStreamToString(aStream, aCount));
      },
      onStopRequest: function (aRequest, aContext, aStatusCode) {
        if (!Components.isSuccessCode(aStatusCode)) {
          // TODO: implement error stuff
        }
        let source = chunks.join("");
        this._onSourceLoad(source, channelCharset);
      }.bind(this)
    };

    if (channel instanceof Ci.nsIPrivateBrowsingChannel) {
      let loadContext = this.win.QueryInterface(Ci.nsIInterfaceRequestor)
                          .getInterface(Ci.nsIWebNavigation)
                          .QueryInterface(Ci.nsILoadContext);
      channel.setPrivate(loadContext.usePrivateBrowsing);
    }
    channel.loadFlags = channel.LOAD_FROM_CACHE;
    channel.asyncOpen(streamListener, null);
  },

  onUpdate: function(aRequest) {
    DOMUtils.parseStyleSheet(this.styleSheet, aRequest.text);
    if (aRequest.transition) {
      this._insertTransistion();
    }
    return {};
  },

  _insertTransistion: function(aRequest) {
    // Insert the global transition rule
    // Use a ref count to make sure we do not add it multiple times.. and remove
    // it only when all pending StyleEditor-generated transitions ended.
    if (!this._transitionRefCount) {
      this.styleSheet.insertRule(TRANSITION_RULE, this.styleSheet.cssRules.length);
      this.doc.documentElement.classList.add(TRANSITION_CLASS);
    }

    this._transitionRefCount++;

    // Set up clean up and commit after transition duration (+10% buffer)
    // @see _onTransitionEnd
    this.win.setTimeout(this._onTransitionEnd.bind(this),
                           Math.floor(TRANSITION_DURATION_MS * 1.1));

  },

  /**
    * This cleans up class and rule added for transition effect and then trigger
    * Commit as the changes have been completed.
    */
  _onTransitionEnd: function SAA_onTransitionEnd()
  {
    if (--this._transitionRefCount == 0) {
      this.doc.documentElement.classList.remove(TRANSITION_CLASS);
      this.styleSheet.deleteRule(this.styleSheet.cssRules.length - 1);
    }
  },

  /**
   * Get a user-friendly name for the style sheet.
   *
   * @return string
   */
  _getFriendlyName: function SSA_getFriendlyName()
  {
    if (this.isNew) {
      let index = this.styleSheetIndex + 1; // 0-indexing only works for devs
      return _("newStyleSheet", index);
    }

    if (this.isInline) {
      let index = this.styleSheetIndex + 1; // 0-indexing only works for devs
      return _("inlineStyleSheet", index);
    }

    if (!this._friendlyName) {
      let sheetURI = this.styleSheet.href;
      let contentURI = this.doc.baseURIObject;
      let contentURIScheme = contentURI.scheme;
      let contentURILeafIndex = contentURI.specIgnoringRef.lastIndexOf("/");
      contentURI = contentURI.specIgnoringRef;

      // get content base URI without leaf name (if any)
      if (contentURILeafIndex > contentURIScheme.length) {
        contentURI = contentURI.substring(0, contentURILeafIndex + 1);
      }

      // avoid verbose repetition of absolute URI when the style sheet URI
      // is relative to the content URI
      this._friendlyName = (sheetURI.indexOf(contentURI) == 0)
                           ? sheetURI.substring(contentURI.length)
                           : sheetURI;
      try {
        this._friendlyName = decodeURI(this._friendlyName);
      } catch (ex) {
      }
    }
    return this._friendlyName;
  }
}

StyleSheetActor.prototype.requestTypes = {
  "getDisabled": StyleSheetActor.prototype.onGetDisabled,
  "setDisabled": StyleSheetActor.prototype.onSetDisabled,
  "fetchSource": StyleSheetActor.prototype.onFetchSource,
  "update": StyleSheetActor.prototype.onUpdate
};


XPCOMUtils.defineLazyGetter(this, "DOMUtils", function () {
  return Cc["@mozilla.org/inspector/dom-utils;1"].getService(Ci.inIDOMUtils);
});
