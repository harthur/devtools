/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Creates a StyleEditorActor. StyleEditorActor provides remote access to the
 * built-in style editor module.
 */
function StyleEditorActor(aConnection)
{
  this.conn = aConnection;

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
  actorPrefix: "styleeditor",

  grip: function SEA_grip()
  {
    return { actor: this.actorID };
  },

  disconnect: function() {

  },

  onListStyleSheets: function() {
    let doc = this._window.document;
    for (let i = 0; i < doc.styleSheets.length; ++i) {
      let styleSheet = doc.styleSheets[i];
    }
    return {"stylesheets": doc.styleSheets};
  },

  onStartProfiler: function(aRequest) {
    this._profiler.StartProfiler(aRequest.entries, aRequest.interval,
                           aRequest.features, aRequest.features.length);
    this._started = true;
    return { "msg": "profiler started" }
  },
  onStopProfiler: function(aRequest) {
    this._profiler.StopProfiler();
    this._started = false;
    return { "msg": "profiler stopped" }
  },
  onGetProfileStr: function(aRequest) {
    var profileStr = this._profiler.GetProfile();
    return { "profileStr": profileStr }
  },
  onGetProfile: function(aRequest) {
    var profile = this._profiler.getProfileData();
    return { "profile": profile }
  },
  onIsActive: function(aRequest) {
    var isActive = this._profiler.IsActive();
    return { "isActive": isActive }
  },
  onGetResponsivenessTimes: function(aRequest) {
    var times = this._profiler.GetResponsivenessTimes({});
    return { "responsivenessTimes": times }
  },
  onGetFeatures: function(aRequest) {
    var features = this._profiler.GetFeatures([]);
    return { "features": features }
  },
  onGetSharedLibraryInformation: function(aRequest) {
    var sharedLibraries = this._profiler.getSharedLibraryInformation();
    return { "sharedLibraryInformation": sharedLibraries }
  },
  onRegisterEventNotifications: function(aRequest) {
    let registered = [];
    for (var event of aRequest.events) {
      if (this._observedEvents.indexOf(event) != -1)
        continue;
      Services.obs.addObserver(this, event, false);
      this._observedEvents.push(event);
      registered.push(event);
    }
    return { registered: registered }
  },
  onUnregisterEventNotifications: function(aRequest) {
    let unregistered = [];
    for (var event of aRequest.events) {
      let idx = this._observedEvents.indexOf(event);
      if (idx == -1)
        continue;
      Services.obs.removeObserver(this, event);
      this._observedEvents.splice(idx, 1);
      unregistered.push(event);
    }
    return { unregistered: unregistered }
  },
  observe: function(aSubject, aTopic, aData) {
    function unWrapper(obj) {
      if (obj && typeof obj == "object" && ("wrappedJSObject" in obj)) {
        obj = obj.wrappedJSObject;
        if (("wrappedJSObject" in obj) && (obj.wrappedJSObject == obj)) {
          /* If the object defines wrappedJSObject as itself, which is the
           * typical idiom for wrapped JS objects, JSON.stringify won't be
           * able to work because the object is cyclic.
           * But removing the wrappedJSObject property will break aSubject
           * for possible other observers of the same topic, so we need
           * to restore wrappedJSObject afterwards */
          delete obj.wrappedJSObject;
          return { unwrapped: obj,
                   fixup: function() {
                     this.unwrapped.wrappedJSObject = this.unwrapped;
                   }
                 }
        }
      }
      return { unwrapped: obj, fixup: function() { } }
    }
    var subject = unWrapper(aSubject);
    var data = unWrapper(aData);
    this.conn.send({ from: this.actorID,
                     type: "eventNotification",
                     event: aTopic,
                     subject: subject.unwrapped,
                     data: data.unwrapped });
    data.fixup();
    subject.fixup();
  },
};

/**
 * The request types this actor can handle.
 */
StyleEditorActor.prototype.requestTypes = {
  "listStyleSheets": ProfilerActor.prototype.onListStyleSheets
};

DebuggerServer.addTabActor(StyleEditorActor, "profilerActor");
