/* vim: set ts=2 et sw=2 tw=80: */
/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

let temp = {}
Cu.import("resource:///modules/devtools/gDevTools.jsm", temp);
let DevTools = temp.DevTools;

let toolbox;
let tab;

function test()
{
  waitForExplicitFinish();

  tab = gBrowser.addTab();
  gBrowser.selectedTab = tab;
  gBrowser.selectedBrowser.addEventListener("load", function onLoad(evt) {
    gBrowser.selectedBrowser.removeEventListener(evt.type, onLoad, true);
    openToolbox();
  }, true);

  content.location = "data:text/html,test for changing targets";
}

function openToolbox()
{
  let target = {
    type: gDevTools.TargetType.TAB,
    value: tab
  }
  toolbox = gDevTools.openToolbox(target);

  toolbox.once("load", testSetter);
}

function testSetter()
{
  toolbox.once("target-changed", cleanup);

  toolbox.target = {
    type: gDevTools.TargetType.TAB,
    value: tab
  };
}

function cleanup()
{
  toolbox.destroy();
  DevTools = toolbox = null;
  gBrowser.removeCurrentTab();
  finish();
}
