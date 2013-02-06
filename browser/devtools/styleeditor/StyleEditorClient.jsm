/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["StyleEditorClient", "StyleSheet"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource:///modules/devtools/EventEmitter.jsm");
Cu.import("resource://gre/modules/devtools/dbg-server.jsm");
Cu.import("resource://gre/modules/devtools/dbg-client.jsm");


let StyleEditorClient = function(target) {
  EventEmitter.decorate(this);
  this._target = target;
}

StyleEditorClient.prototype = {
  connect: function(callback) {
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

  getStyleSheets: function(callback) {
    var message = { to: this._actor, type: "getStyleSheets" };
    this.client.request(message, callback);
  }
}

let StyleSheet = function(form, client) {
  dump("HEATHER: client " + "\n");
  this._client = client;
  this._actor = form.actor;
  dump("HEATHER: " + JSON.stringify(form) + "\n");
}

StyleSheet.prototype = {
  getDisabled : function(callback) {
    dump("HEATHER: client " + this._client.request + "\n");
    dump("HEATHER: actor " + this._actor + "\n");
    var message = { to: this._actor, type: "getDisabled" };
    this._client.request(message, function(aResponse) {
      callback(aResponse.disabled);
    });
  },

  update: function(sheetText, callback) {
  }
}
