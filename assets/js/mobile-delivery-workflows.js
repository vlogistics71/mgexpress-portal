/* MG Express: compact, accessible mobile Edit Job + Assign Driver workflows.
   Original save and assignment handlers remain the only sources of mutations. */
(() => {
  "use strict";
  const isMobile = () => window.matchMedia("(max-width: 720px)").matches;

  function navigation(panel, labels, options) {
    const bar = document.createElement("div");
    bar.className = "mg-workflow-progress";
    bar.setAttribute("aria-label", options.title + " steps");
    const top = document.createElement("div");
    top.className = "mg-workflow-progress-header";
    const title = document.createElement("strong");
    const count = document.createElement("span");
    top.append(title, count);
    const track = document.createElement("div");
    track.className = "mg-workflow-track";
    track.style.setProperty("--steps", String(labels.length));
    const segments = labels.map(() => {
      const line = document.createElement("i");
      track.appendChild(line);
      return line;
    });
    const tabs = document.createElement("nav");
    tabs.className = "mg-workflow-tabs";
    tabs.setAttribute("aria-label", options.title + " sections");
    const buttons = labels.map((label, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => options.open(index));
      tabs.appendChild(button);
      return button;
    });
    bar.append(top, track, tabs);
    const footer = document.createElement("div");
    footer.className = "mg-workflow-footer";
    const back = document.createElement("button");
    back.className = "mg-workflow-prev";
    back.type = "button";
    const next = document.createElement("button");
    next.className = "mg-workflow-next";
    next.type = "button";
    footer.append(back, next);
    panel.classList.add("mg-steps-ready");
    options.header.after(bar);
    panel.appendChild(footer);

    function render(index) {
      title.textContent = labels[index];
      count.textContent = "Step " + (index + 1) + " of " + labels.length;
      segments.forEach((segment, i) => segment.classList.toggle("done", i <= index));
      buttons.forEach((button, i) => {
        if (i === index) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
      back.textContent = index === 0 ? "← Close" : "← Back";
      next.textContent = index === labels.length - 1 ? options.lastLabel : "Next: " + labels[index + 1];
      next.hidden = Boolean(options.hideLastNext && index === labels.length - 1);
      const currentButton = buttons[index];
      if (isMobile()) {
        const target = currentButton.offsetLeft - tabs.offsetLeft -
          (tabs.clientWidth - currentButton.offsetWidth) / 2;
        tabs.scrollTo({left:Math.max(0,target),behavior:"smooth"});
      }
    }
    return {bar, footer, back, next, render};
  }

  function modalWatcher(modal, onOpen) {
    let previouslyOpen = modal.classList.contains("open");
    const watcher = new MutationObserver(() => {
      const nowOpen = modal.classList.contains("open");
      if (nowOpen && !previouslyOpen) onOpen();
      previouslyOpen = nowOpen;
    });
    watcher.observe(modal, {attributes:true,attributeFilter:["class"]});
    if (previouslyOpen) onOpen();
  }

  function initEdit() {
    const modal = document.getElementById("editJobModal");
    const panel = modal?.querySelector(".edit-panel");
    const header = panel?.querySelector(".edit-panel-head");
    const body = panel?.querySelector(".edit-panel-body");
    const form = document.getElementById("editJobForm");
    const originalSubmit = document.getElementById("saveEditJobButton");
    const sections = form ? Array.from(form.querySelectorAll(":scope > .edit-section")) : [];
    if (!modal || !panel || !header || !body || !form || !originalSubmit || sections.length !== 6) return;

    const labels = sections.map(s => s.querySelector(".edit-section-title")?.textContent.trim() || "Details");
    let step = 0;
    const controls = navigation(panel,labels,{title:"Edit Job",header,open:goTo,lastLabel:"Save Changes",hideLastNext:true});
    const save = document.createElement("button");
    save.className = "mg-workflow-save";
    save.textContent = "Save Changes";
    save.type = "submit";
    save.setAttribute("form", "editJobForm");
    controls.footer.appendChild(save);

    function isConditionallyShown(field, section) {
      if (field.disabled || !field.willValidate) return false;
      let node = field;
      while (node && node !== section) {
        if (node.hidden || node.classList?.contains("hidden") ||
            node.style?.display === "none" || node.style?.visibility === "hidden") {
          return false;
        }
        node = node.parentElement;
      }
      return true;
    }
    function firstInvalid(index) {
      const section = sections[index];
      return Array.from(section.querySelectorAll("input,select,textarea")).find(
        field => isConditionallyShown(field, section) && !field.checkValidity()
      );
    }

    function goTo(index, focus = false) {
      if (index > step && isMobile()) {
        const invalid = firstInvalid(step);
        if (invalid) {
          invalid.focus({preventScroll:true});
          invalid.reportValidity();
          return;
        }
      }
      step = Math.max(0,Math.min(sections.length - 1,index));
      sections.forEach((section, i) => section.classList.toggle("mg-edit-active", i === step));
      controls.render(step);
      save.hidden = step !== sections.length - 1;
      body.scrollTop = 0;
      form.scrollTop = 0;
      if (focus) sections[step].querySelector("input:not([type=hidden]),select,textarea")?.focus({preventScroll:true});
    }
    function directStep(index) {
      step = Math.max(0, Math.min(sections.length - 1,index));
      sections.forEach((section,i) => section.classList.toggle("mg-edit-active",i===step));
      controls.render(step);
      save.hidden = step !== sections.length - 1;
      form.scrollTop = 0;
    }
    controls.back.addEventListener("click", () => {
      if (step === 0) panel.querySelector('[data-close-modal="editJobModal"]')?.click();
      else directStep(step-1);
    });
    controls.next.addEventListener("click", () => goTo(step+1));

    // Reveal invalid fields before native constraint validation attempts to focus them.
    save.addEventListener("click", event => {
      if (!isMobile()) return;
      for (let i=0; i<sections.length; i++) {
        const invalid = firstInvalid(i);
        if (!invalid) continue;
        event.preventDefault();
        directStep(i);
        requestAnimationFrame(() => {invalid.focus({preventScroll:true});invalid.reportValidity();});
        return;
      }
    },true);
    form.addEventListener("invalid", event => {
      if (!isMobile() || !modal.classList.contains("open")) return;
      const index = sections.findIndex(section => section.contains(event.target));
      if (index >= 0 && index !== step) {
        event.preventDefault();
        directStep(index);
        requestAnimationFrame(() => {event.target.focus({preventScroll:true});event.target.reportValidity();});
      }
    },true);
    modalWatcher(modal, () => directStep(0));
    directStep(0);
  }

  function initAssign() {
    const modal = document.getElementById("assignModal");
    const panel = modal?.querySelector(".assign-panel");
    const header = panel?.querySelector(".assign-panel-head");
    const body = panel?.querySelector(".assign-panel-body");
    if (!modal || !panel || !header || !body) return;
    const summary = body.querySelector(":scope > .assign-job-card");
    const recommended = body.querySelector(":scope > .assign-recommended");
    const drivers = body.querySelector(":scope > .assign-list");
    const notes = body.querySelector(":scope > .assign-future");
    if (!summary || !recommended || !drivers) return;
    const stages = [[summary],[recommended,drivers,notes].filter(Boolean)];
    const controls = navigation(panel,["Job & Pay","Choose Driver"],{
      title:"Assign Driver",header,open:setStep,lastLabel:"",hideLastNext:true
    });
    const helper = document.createElement("div");
    helper.className = "mg-assign-help";
    helper.textContent = "Select a driver above to continue with assignment.";
    helper.hidden = true;
    controls.footer.appendChild(helper);
    let step = 0;
    function setStep(index) {
      step=Math.max(0,Math.min(stages.length - 1,index));
      const visible=new Set(stages[step]);
      [summary,recommended,drivers,notes].filter(Boolean).forEach(el=>{
        el.classList.toggle("mg-assign-active",visible.has(el));
      });
      controls.render(step);
      helper.hidden=step!==1;
      body.scrollTop=0;
    }
    controls.back.addEventListener("click",()=>{
      if (step===0) panel.querySelector('[data-close-modal="assignModal"]')?.click();
      else setStep(step-1);
    });
    controls.next.addEventListener("click",()=>setStep(1));
    modalWatcher(modal,()=>setStep(0));
    setStep(0);
  }

  initEdit();
  initAssign();
})();
