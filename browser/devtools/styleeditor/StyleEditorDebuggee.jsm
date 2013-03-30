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

XPCOMUtils.defineLazyModuleGetter(this, "Promise",
    "resource://gre/modules/commonjs/sdk/core/promise.js");

/**
 * A StyleEditorDebuggee represents the document the style editor is debugging.
 * It maintains a list of StyleSheet objects that represent the stylesheets in
 * the target's document. It wraps remote debugging protocol comunications.
 *
 * @param {Target} target The target the debuggee is listening to
 */
let StyleEditorDebuggee = function(target) {
  EventEmitter.decorate(this);

  this.styleSheets = [];

  this.clear = this.clear.bind(this);
  this._onNewDocument = this._onNewDocument.bind(this);
  this._onStyleSheetsAdded = this._onStyleSheetsAdded.bind(this);

  this._target = target;
  this._actor = this.target.form.styleEditorActor;

  this.client.addListener("styleSheetsAdded", this._onStyleSheetsAdded);
  this._target.on("navigate", this._onNewDocument);

  this._onNewDocument();
}

StyleEditorDebuggee.prototype = {
  styleSheets: null, /* list of StyleSheet objects for this target */

  baseURI: null,   /* baseURIObject for the current document */

  get target() {
    return this._target;
  },

  get client() {
    return this._target.client;
  },

  /**
   * Clear stylesheets and state.
   */
  clear: function(callback) {
    this.baseURI = null;

    for (let stylesheet of this.styleSheets) {
      stylesheet.destroy();
    }
    this.styleSheets = [];

    this.emit("stylesheets-cleared");
  },

  /**
   * Called when target is created or has navigated.
   * Clear previous sheets and request new document's
   */
  _onNewDocument: function() {
    this.clear();
    this._getBaseURI();

    var message = { type: "newDocument" };
    this._sendRequest(message);
  },

  /**
   * request baseURIObject information from the document
   */
  _getBaseURI: function() {
    var message = { type: "getBaseURI" };
    this._sendRequest(message, function(response) {
      this.baseURI = response.baseURI;
    }.bind(this));
  },

  /**
   * Handle stylesheet-added event from the target
   */
  _onStyleSheetsAdded: function(type, request) {
    for (let form of request.styleSheets) {
      let sheet = this._addStyleSheet(form);
      this.emit("stylesheet-added", sheet);
    }
  },

  /**
   * Create a new StyleSheet object from the form
   * and add our stylesheet list.
   */
  _addStyleSheet: function(form) {
    var sheet = new StyleSheet(form, this);
    this.styleSheets.push(sheet);
    return sheet;
  },

  /**
   * Create a new stylesheet with the given text
   * and attach it to the document.
   */
  createStyleSheet: function(text, callback) {
    var message = { type: "newStyleSheet", text: text };
    this._sendRequest(message, function(response)) {
      var sheet = this._addStyleSheet(response.styleSheet);
      callback(sheet);
    }.bind(this));
  },

  /**
   * Send a request to our actor on the server
   */
  _sendRequest: function(message, callback) {
    message.to = this._actor;
    this._client.request(message, callback);
  },

  /**
   * Clean up and remove listeners
   */
  destroy: function() {
    this.clear();

    this._target.off("will-navigate", this.clear);
    this._target.off("navigate", this._onNewDocument);
  }
}

/**
 * A StyleSheet object represents a stylesheet on the debuggee. It wraps
 * communication with a complimentary StyleSheetActor on the server.
 *
 * @param {object} form     initial properties of the stylesheet
 * @param {StyleEditorDebuggee} debuggee owner of the stylesheet
 */
let StyleSheet = function(form, debuggee) {
  EventEmitter.decorate(this);

  this.debuggee = debuggee;
  this._client = debuggee.client;
  this._actor = form.actor;

  this._onSourceLoad = this._onSourceLoad.bind(this);
  this._onPropertyChange = this._onPropertyChange.bind(this);
  this._onError = this._onError.bind(this);

  this._client.addListener("sourceLoad-" + this._actor, this._onSourceLoad);
  this._client.addListener("propertyChange-" + this._actor, this._onPropertyChange);
  this._client.addListener("error-" + this._actor, this._onError);
  this._client.addListener("styleApplied-" + this._actor, this._onStyleApplied);

  // set initial property values
  for (var attr in form) {
    this[attr] = form[attr];
  }
}

StyleSheet.prototype = {
  /**
   * Toggle the disabled attribute of the stylesheet
   */
  toggleDisabled: function() {
    let message = { type: "toggleDisabled" };
    this._sendRequest(message);
  },

  /**
   * Request that the source of the stylesheet be fetched.
   * 'source-load' event will be fired when it's been fetched.
   */
  fetchSource: function() {
    let message = { type: "fetchSource" };
    this._sendRequest(message);
  },

  /**
   * Update the stylesheet in place with the given full source.
   */
  update: function(sheetText) {
    let message = { type: "update", text: sheetText, transition: true };
    this._sendRequest(message);
  },

  /**
   * Handle source load event from the client
   */
  _onSourceLoad: function(type, request) {
    this.emit("source-load", request.source);
  },

  /**
   * Handle a property change on the stylesheet
   */
  _onPropertyChange: function(type, request) {
    this[request.property] = request.value;
    this.emit("property-change", request.property);
  },

  /**
   * Propogate errors from the server that relate to this stylesheet.
   */
  _onError: function(type, request) {
    this.emit("error", request.errorMessage);
  },

  /**
   * Handle event when update has been successfully applied and propogate it.
   */
  _onStyleApplied: function() {
    this.emit("style-applied");
  },

  /**
   * Send a request to our actor
   */
  _sendRequest: function(message, callback) {
    message.to = this._actor;
    this._client.request(message, callback);
  },

  /**
   * Clean up and remove event listeners
   */
  destroy: function() {
    this._client.removeListener("sourceLoad-" + this._actor, this._onSourceLoad);
    this._client.removeListener("propertyChange-" + this._actor, this._onPropertyChange);
    this._client.removeListener("error-" + this._actor, this._onError);
    this._client.removeListener("styleApplied-" + this._actor, this._onStyleApplied);
  }
}
