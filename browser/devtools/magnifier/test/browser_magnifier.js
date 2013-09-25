/* vim: set ts=2 et sw=2 tw=80: */
/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

let doc;
let inspector;
let view;

const TEST_URI = "http://example.com/browser/browser/" +
                 "devtools/magnifier/test/" +
                 "browser_magnifier.html";

function testMagnifier(aInspector, aRuleView)
{
  inspector = aInspector;
  view = aRuleView;

  finishTest();
}

function finishTest()
{
  doc = null;
  gBrowser.removeCurrentTab();
  finish();
}

function test()
{
  waitForExplicitFinish();
  gBrowser.selectedTab = gBrowser.addTab();
  gBrowser.selectedBrowser.addEventListener("load", function(evt) {
    gBrowser.selectedBrowser.removeEventListener(evt.type, arguments.callee, true);
    doc = content.document;
    waitForFocus(() => testMagnifier(), content);
  }, true);

  content.location = TEST_URI;
}
