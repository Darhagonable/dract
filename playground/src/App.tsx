import Counter from "./Counter";
import ProfileForm from "./ProfileForm";
import { Dashboard } from "./Dashboard";
import { RenamedPropsDemo } from "./RenamedPropsDemo";
import { ContextDemo } from "./ContextDemo";
import { ReactiveContextDemo } from "./ReactiveContextDemo";
import { StyleShowcase } from "./styling/StyleShowcase";
import { test } from "./helper-test";

export default component App() {

  state reactive = "I am reactive";
  let nonReactive = "I am not reactive";

  function changeVars() {
    test(reactive, nonReactive);
  }

  function changeVars2() {
    test(nonReactive, reactive);
  }

  render (
    <div>
      <p>{reactive}</p>
      <p>{nonReactive}</p>
      <button onclick={changeVars}>Change Vars</button>
      <button onclick={changeVars2}>Change Vars 2</button>
      <Counter />
      <hr />
      <Dashboard />
      <hr />
      <RenamedPropsDemo />
      <hr />
      <ProfileForm />
      <hr />
      <ContextDemo />
      <hr />
      <ReactiveContextDemo />
      <hr />
      <StyleShowcase />
    </div>
  )
}
