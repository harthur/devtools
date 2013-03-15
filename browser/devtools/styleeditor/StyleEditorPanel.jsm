/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { classes: Cc, interfaces: Ci, utils: Cu, results: Cr } = Components;

this.EXPORTED_SYMBOLS = ["StyleEditorPanel"];

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js");
Cu.import("resource:///modules/devtools/EventEmitter.jsm");
Cu.import("resource:///modules/devtools/StyleEditorDebuggee.jsm");
Cu.import("resource:///modules/devtools/StyleEditorUI.jsm");
Cu.import("resource:///modules/devtools/StyleEditorUtil.jsm");


XPCOMUtils.defineLazyModuleGetter(this, "StyleEditorChrome",
                        "resource:///modules/devtools/StyleEditorChrome.jsm");

this.StyleEditorPanel = function StyleEditorPanel(panelWin, toolbox) {
  EventEmitter.decorate(this);

  this._toolbox = toolbox;
  this._target = toolbox.target;
  this._panelDoc = panelWin.document;

  this.destroy = this.destroy.bind(this);
  this.beforeNavigate = this.beforeNavigate.bind(this);
  this._showError = this._showError.bind(this);

  this._target.on("will-navigate", this.beforeNavigate);
  this._target.on("close", this.destroy);
}

StyleEditorPanel.prototype = {
  /**
   * open is effectively an asynchronous constructor
   */
  open: function StyleEditor_open() {
    let deferred = Promise.defer();

    let contentWin = this._toolbox.target.window;

    this._debuggee = new StyleEditorDebuggee(this._toolbox.target);

    this._debuggee.initialize(function() {
      this._UI = new StyleEditorUI(this._debuggee, this._panelDoc);
      this._UI.on("error", this._showError);

      this._UI.initialize();

      this.isReady = true;
      deferred.resolve(this);
    }.bind(this));

    return deferred.promise;
  },

  _showError: function(event, errorCode) {
    let message = _(errorCode);
    let notificationBox = this._toolbox.getNotificationBox();
    let notification = notificationBox.getNotificationWithValue("styleeditor-error");
    if (!notification) {
      notificationBox.appendNotification(message,
        "styleeditor-error", "", notificationBox.PRIORITY_CRITICAL_LOW);
    }
  },

  /**
   * Before navigating to a new page or reloading the page.
   */
  beforeNavigate: function StyleEditor_beforeNavigate(event, request) {
    if (this._UI.isDirty) {
      this.preventNavigate(request);
    }
  },

  /**
   * Show a notificiation about losing unsaved changes.
   */
  preventNavigate: function StyleEditor_preventNavigate(request) {
    request.suspend();

    let notificationBox = null;
    if (this._target.isLocalTab) {
      let gBrowser = this._target.tab.ownerDocument.defaultView.gBrowser;
      notificationBox = gBrowser.getNotificationBox();
    }
    else {
      notificationBox = this._toolbox.getNotificationBox();
    }

    let notification = notificationBox.
      getNotificationWithValue("styleeditor-page-navigation");

    if (notification) {
      notificationBox.removeNotification(notification, true);
    }

    let cancelRequest = function onCancelRequest() {
      if (request) {
        request.cancel(Cr.NS_BINDING_ABORTED);
        request.resume(); // needed to allow the connection to be cancelled.
        request = null;
      }
    };

    let eventCallback = function onNotificationCallback(event) {
      if (event == "removed") {
        cancelRequest();
      }
    };

    let buttons = [
      {
        id: "styleeditor.confirmNavigationAway.buttonLeave",
        label: this.strings.GetStringFromName("confirmNavigationAway.buttonLeave"),
        accessKey: this.strings.GetStringFromName("confirmNavigationAway.buttonLeaveAccesskey"),
        callback: function onButtonLeave() {
          if (request) {
            request.resume();
            request = null;
          }
        }.bind(this),
      },
      {
        id: "styleeditor.confirmNavigationAway.buttonStay",
        label: this.strings.GetStringFromName("confirmNavigationAway.buttonStay"),
        accessKey: this.strings.GetStringFromName("confirmNavigationAway.buttonStayAccesskey"),
        callback: cancelRequest
      },
    ];

    let message = this.strings.GetStringFromName("confirmNavigationAway.message");

    notification = notificationBox.appendNotification(message,
      "styleeditor-page-navigation", "chrome://browser/skin/Info.png",
      notificationBox.PRIORITY_WARNING_HIGH, buttons, eventCallback);

    // Make sure this not a transient notification, to avoid the automatic
    // transient notification removal.
    notification.persistence = -1;
  },

  /**
   * Select a stylesheet. TODO
   */
  selectStyleSheet: function(stylesheet, line, col) {
    this._UI.selectStyleSheet(stylesheet, line, col); // TODO
  },

  /**
   * Destroy StyleEditor
   */
  destroy: function() {
    if (!this._destroyed) {
      this._destroyed = true;

      this._target.off("will-navigate", this.beforeNavigate);
      this._target.off("close", this.destroy);
      this._target = null;
      this._toolbox = null;
      this._panelDoc = null;

      this._debuggee.destroy();
      this._UI.destroy();
    }

    return Promise.resolve(null);
  },
}

XPCOMUtils.defineLazyGetter(StyleEditorPanel.prototype, "strings",
  function () {
    return Services.strings.createBundle(
            "chrome://browser/locale/devtools/styleeditor.properties");
  });