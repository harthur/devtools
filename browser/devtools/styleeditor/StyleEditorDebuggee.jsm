/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["StyleEditorDebuggee", "StyleSheet"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource:///modules/devtools/EventEmitter.jsm");
Cu.import("resource://gre/modules/devtools/dbg-server.jsm");
Cu.import("resource://gre/modules/devtools/dbg-client.jsm");


let StyleEditorDebuggee = function(target) {
  EventEmitter.decorate(this);

  this.styleSheets = [];

  this.clear = this.clear.bind(this);
  this._onNewDocument = this._onNewDocument.bind(this);
  this._onStyleSheetsAdded = this._onStyleSheetsAdded.bind(this);

  this._target = target;

  this._target.on("will-navigate", this.clear);
  this._target.on("navigate", this._onNewDocument);
}

StyleEditorDebuggee.prototype = {
  styleSheets: null, /* list of StyleSheet objects for this target */

  baseURI: null,   /* baseURIObject for the current document */

  initialize: function(callback) {
    this._connect(function() {
      this.client.addListener("styleSheetsAdded", this._onStyleSheetsAdded);

      this._onNewDocument();
      callback();
    }.bind(this));
  },

  _connect: function(callback) {
    if (this._target.client) {
      this.client = this._target.client;
      this._actor = this._target.form.styleEditorActor;
      callback();
    }
    else {
      if (!DebuggerServer.initialized) {
        DebuggerServer.init();
        DebuggerServer.addBrowserActors();
      }

      let transport = DebuggerServer.connectPipe();
      this.client = new DebuggerClient(transport);

      this.client.connect(function(type, traits) {
        this.client.listTabs(function (response) {
          let tab = response.tabs[response.selected];
          this._actor = tab.styleEditorActor;
          callback();
        }.bind(this));
      }.bind(this))
    }
  },

  clear: function(callback) {
    this.baseURI = null;
    this.styleSheets = [];

    this.emit("stylesheets-cleared");
  },

  _onNewDocument: function() {
    this._getBaseURI()
    this._addLoadListener();
  },

  _getBaseURI: function() {
    var message = { to: this._actor, type: "getBaseURI" };
    this.client.request(message, function(response) {
      this.baseURI = response.baseURI;
    }.bind(this));
  },

  _addLoadListener: function() {
    var message = { to: this._actor, type: "addLoadListener" };
    this.client.request(message, function(response) {
    });
  },

  _onStyleSheetsAdded: function(type, request) {
    for (let form of request.styleSheets) {
      let sheet = this._addStyleSheet(form);
      this.emit("stylesheet-added", sheet);
    }
  },

  _addStyleSheet: function(form) {
    var sheet = new StyleSheet(form, this);
    this.styleSheets.push(sheet);
    return sheet;
  },

  createStyleSheet: function(text, callback) {
    var message = { to: this._actor, type: "newStyleSheet", text: text }
    this.client.request(message, function(response) {
      var sheet = this._addStyleSheet(response.styleSheet);
      callback(sheet);
    }.bind(this));
  },

  _fetchStyleSheets: function(callback) {
    var message = { to: this._actor, type: "getStyleSheets" };
    this.client.request(message, function(response) {
      callback(response.styleSheets);
    });
  }
}

let StyleSheet = function(form, debuggee) {
  EventEmitter.decorate(this);

  this.debuggee = debuggee;
  this._client = debuggee.client;
  this._actor = form.actor;

  this._onSourceLoad = this._onSourceLoad.bind(this);
  this._onPropertyChange = this._onPropertyChange.bind(this);

  this._client.addListener("sourceLoad-" + this._actor, this._onSourceLoad);
  this._client.addListener("propertyChange-" + this._actor, this._onPropertyChange);

  this.importFromForm(form);
}

StyleSheet.prototype = {
  importFromForm: function(form) {
    for (var attr in form) {
      this[attr] = form[attr];
    }
  },

  toggleDisabled: function() {
    let message = { type: "toggleDisabled" };
    this._sendRequest(message, function(response) {
    });
  },

  fetchSource: function() {
    let message = { type: "fetchSource" };
    this._sendRequest(message, function(response) {
      // TODO: err handling
    })
  },

  update: function(sheetText) {
    let message = { type: "update", text: sheetText, transition: true };
    this._sendRequest(message, function(response) {
    });
  },

  _sendRequest: function(message, callback) {
    message.to = this._actor;
    this._client.request(message, callback);
  },

  _onSourceLoad: function(type, request) {
    this.emit("source-load", request.source);
  },

  _onPropertyChange: function(type, request) {
    this.importFromForm(request.form)
    this.emit("property-change");
  }
}
