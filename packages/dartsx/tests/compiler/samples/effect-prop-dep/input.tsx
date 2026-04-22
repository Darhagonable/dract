import { effect } from 'dartsx'

component Dialog(open: boolean) {
  effect(open, (isOpen) => {
    console.log(isOpen);
  })

  render (
    <p>{open}</p>
  )
}
