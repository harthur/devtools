/* vim: set ts=2 et sw=2 tw=80: */
/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

const TESTCASE_URI = TEST_BASE + "simple.html";

const TRANSITION_CLASS = "moz-styleeditor-transitioning";
const TESTCASE_CSS_SOURCE = "body{background-color:red;";

let gUI;

function test()
{
  waitForExplicitFinish();

  addTabAndOpenStyleEditor(function(panel) {
    gUI = panel.UI;
    gUI.on("editor-added", testEditorAdded);
  });

  content.location = TESTCASE_URI;
}

let gAddedCount = 0;  // to add new stylesheet after the 2 initial stylesheets
let gNewEditor;       // to make sure only one new stylesheet got created
let gUpdateCount = 0; // to make sure only one Update event is triggered
let gCommitCount = 0; // to make sure only one Commit event is triggered
let gTransitionEndCount = 0;
let gOriginalStyleSheet;
let gOriginalOwnerNode;
let gOriginalHref;


function finishOnTransitionEndAndCommit() {
  if (gCommitCount && gTransitionEndCount) {
    is(gCommitCount, 1, "received one Commit event");
    is(gTransitionEndCount, 1, "received one transitionend event");

    if (gNewEditor) {
      is(gNewEditor.styleSheet, gOriginalStyleSheet,
         "style sheet object did not change");
      is(gNewEditor.styleSheet.ownerNode, gOriginalOwnerNode,
         "style sheet owner node did not change");
      is(gNewEditor.styleSheet.href, gOriginalHref,
         "style sheet href did not change");

      gNewEditor = null;
      gUI = null;
      finish();
    }
  }
}

function testEditorAdded(aEvent, aEditor)
{
  gAddedCount++;
  if (gAddedCount == 2) {
    waitForFocus(function () {// create a new style sheet
      let newButton = gPanelWindow.document.querySelector(".style-editor-newButton");
      ok(newButton, "New button exists");

      EventUtils.synthesizeMouseAtCenter(newButton, {}, gPanelWindow);
    }, gPanelWindow);
  }
  if (gAddedCount != 3) {
    return;
  }

  ok(!gNewEditor, "creating a new stylesheet triggers one EditorAdded event");
  gNewEditor = aEditor; // above test will fail if we get a duplicate event

  is(gUI.editors.length, 3,
     "creating a new stylesheet added a new StyleEditor instance");

  aEditor.getSourceEditor().then(function() {
    dump("HEATHER: got the source editor " + "\n");
    testEditor();
  });

dump("HEATHER: adding style applied listener" +  + "\n");

  aEditor.styleSheet.once("style-applied", function() {
    dump("HEATHER: style has been applied " + "\n");
    // when changes have been completely applied to live stylesheet after transisiton
    let summary = aChrome.getSummaryElementForEditor(aEditor);
    let ruleCount = summary.querySelector(".stylesheet-rule-count").textContent;
    is(parseInt(ruleCount), 1,
       "new editor shows 1 rule after modification");

    ok(!content.document.documentElement.classList.contains(TRANSITION_CLASS),
       "StyleEditor's transition class has been removed from content");

    executeSoon(finishOnTransitionEndAndCommit);
  });
}

function testEditor() {
  waitForFocus(function () {
  gOriginalStyleSheet = aEditor.styleSheet;
  gOriginalOwnerNode = aEditor.styleSheet.ownerNode;
  gOriginalHref = aEditor.styleSheet.href;

  let summary = aChrome.getSummaryElementForEditor(aEditor);

  ok(aEditor.isLoaded,
     "new editor is loaded when attached");
  ok(aEditor.hasFlag("new"),
     "new editor has NEW flag");
  ok(aEditor.hasFlag("unsaved"),
     "new editor has UNSAVED flag");

  ok(aEditor.inputElement,
     "new editor has an input element attached");

  ok(aEditor.sourceEditor.hasFocus(),
     "new editor has focus");

  let summary = aChrome.getSummaryElementForEditor(aEditor);
  let ruleCount = summary.querySelector(".stylesheet-rule-count").textContent;
  is(parseInt(ruleCount), 0,
     "new editor initially shows 0 rules");

  let computedStyle = content.getComputedStyle(content.document.body, null);
  is(computedStyle.backgroundColor, "rgb(255, 255, 255)",
     "content's background color is initially white");

  EventUtils.synthesizeKey("[", {accelKey: true}, gChromeWindow);
  is(aEditor.sourceEditor.getText(), "",
     "Nothing happened as it is a known shortcut in source editor");

  EventUtils.synthesizeKey("]", {accelKey: true}, gChromeWindow);
  is(aEditor.sourceEditor.getText(), "",
     "Nothing happened as it is a known shortcut in source editor");

  for each (let c in TESTCASE_CSS_SOURCE) {
    EventUtils.synthesizeKey(c, {}, gChromeWindow);
  }

  is(aEditor.sourceEditor.getText(), TESTCASE_CSS_SOURCE + "}",
     "rule bracket has been auto-closed");

  // we know that the testcase above will start a CSS transition
  content.addEventListener("transitionend", function () {
    gTransitionEndCount++;

    let computedStyle = content.getComputedStyle(content.document.body, null);
    is(computedStyle.backgroundColor, "rgb(255, 0, 0)",
       "content's background color has been updated to red");

    executeSoon(finishOnTransitionEndAndCommit);
  }, false);
}, gChromeWindow) ;
}
