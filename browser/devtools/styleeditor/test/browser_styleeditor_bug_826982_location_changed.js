/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

let tempScope = {};
Cu.import("resource:///modules/devtools/Target.jsm", tempScope);
let TargetFactory = tempScope.TargetFactory;

function test() {
  waitForExplicitFinish();

  addTabAndOpenStyleEditor(function(panel) {
    runTests(panel.UI);
  });

  content.location = "data:text/html,<div>location change tests for " +
    "styleeditor.</div><p>init</p>";
}

let notificationBox, styleEditor;
let alertActive1_called = false;
let alertActive2_called = false;

function startLocationTests() {
  let target = TargetFactory.forTab(gBrowser.selectedTab);

  gDevTools.showToolbox(target, "styleeditor").then(function(toolbox) {
    runTests(toolbox.getCurrentPanel(), toolbox);
  }).then(null, console.error);
}

function runTests(aUI) {
  let para = content.document.querySelector("p");
  ok(para, "found the paragraph element");
  is(para.textContent, "init", "paragraph content is correct");

  aUI.isDirty = true;

  notificationBox = gBrowser.getNotificationBox();
  notificationBox.addEventListener("AlertActive", alertActive1, false);

  gBrowser.selectedBrowser.addEventListener("load", onPageLoad, true);

  dump("HEATHER: setting content to test1 location" + "\n");
  content.location = "data:text/html,<div>location change test 1 for " +
    "styleeditor</div><p>test1</p>";
}

function alertActive1() {
  dump("HEATHER: alert active1 called"  + "\n");
  alertActive1_called = true;
  notificationBox.removeEventListener("AlertActive", alertActive1, false);

  let notification = notificationBox.
    getNotificationWithValue("styleeditor-page-navigation");
  ok(notification, "found the styleeditor-page-navigation notification");

  // By closing the notification it is expected that page navigation is
  // canceled.
  executeSoon(function() {
    notification.close();
    locationTest2();
  });
}

function locationTest2() {
  // Location did not change.
  let para = content.document.querySelector("p");
  ok(para, "found the paragraph element, second time");
  is(para.textContent, "init", "paragraph content is correct");

  notificationBox.addEventListener("AlertActive", alertActive2, false);

  content.location = "data:text/html,<div>location change test 2 for " +
    "styleeditor</div><p>test2</p>";
}

function alertActive2() {
  dump("HEATHER: alert active 2"  + "\n");
  alertActive2_called = true;
  notificationBox.removeEventListener("AlertActive", alertActive2, false);

  let notification = notificationBox.
    getNotificationWithValue("styleeditor-page-navigation");
  ok(notification, "found the styleeditor-page-navigation notification");

  let buttons = notification.querySelectorAll("button");
  let buttonLeave = null;
  for (let i = 0; i < buttons.length; i++) {
    if (buttons[i].buttonInfo.id == "styleeditor.confirmNavigationAway.buttonLeave") {
      buttonLeave = buttons[i];
      break;
    }
  }

  ok(buttonLeave, "the Leave page button was found");

  // Accept page navigation.
  executeSoon(function(){
    buttonLeave.doCommand();
  });
}

function onPageLoad() {
  dump("HEATHER: on page load" + "\n");
  gBrowser.selectedBrowser.removeEventListener("load", onPageLoad, true);

  dump("HEATHER: page: " + content.document.querySelector("p").textContent + "\n");

  isnot(content.location.href.indexOf("test2"), -1,
        "page navigated to the correct location");

  let para = content.document.querySelector("p");
  ok(para, "found the paragraph element, third time");
  is(para.textContent, "test2", "paragraph content is correct");

  ok(alertActive1_called, "first notification box has been shown");
  ok(alertActive2_called, "second notification box has been shown");
  testEnd();
}

function testEnd() {
  notificationBox = null;
  gBrowser.removeCurrentTab();
  executeSoon(finish);
}
