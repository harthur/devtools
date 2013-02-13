/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["StyleSheet"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource:///modules/devtools/EventEmitter.jsm");

let StyleSheet = function(form, client) {
  EventEmitter.decorate(this);

  this._client = client;
  this._actor = form.actor;

  this._onSourceLoad = this._onSourceLoad.bind(this);

  this._client.addListener("sourceLoad", this._onSourceLoad);

  // include everything from the form like href, title
  for (var attr in form) {
    this[attr] = form[attr];
  }
}

StyleSheet.prototype = {
  getDisabled : function(callback) {
    var message = { to: this._actor, type: "getDisabled" };
    this._client.request(message, function(response) {
      callback(response.disabled);
    });
  },

  fetchSource: function() {
    var message = { to: this._actor, type: "fetchSource" };
    this._client.request(message, function(response) {
      // TODO: err handling
    })
  },

  update: function(sheetText, callback) {
  },

  _onSourceLoad: function(type, request) {
    this.emit("source-load", request.source);
  }
}
