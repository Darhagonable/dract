import { effect } from 'dartsx'

const open = 'hello'

function log(x: any) { console.log(x) }

log(open)

component Dialog(open: boolean) {
  effect(open, (isOpen) => { console.log(isOpen) })

  render (
    <p>{open}</p>
  )
}
