import { createContext } from 'dartsx'

export function useProfile() {
	state profile = { name: 'Alice' }
	return profile
}

export const ProfileContext = createContext(() => {
	state user = 'bob'
	return { user }
})
