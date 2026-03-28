import { createContext, useContext, useMemo, useState } from 'react'
import type { TutorProfile, UserProfile } from '../types'
import { createInitialProfile } from '../utils/profile'

interface TutorContextValue {
  profile: UserProfile
  setProfile: (profile: UserProfile) => void
  tutor: TutorProfile
  setTutor: (tutor: TutorProfile) => void
}

const TutorContext = createContext<TutorContextValue | undefined>(undefined)

export const TutorProvider = ({ children }: { children: React.ReactNode }) => {
  const [profile, setProfile] = useState<UserProfile>(createInitialProfile())
  const [tutor, setTutor] = useState<TutorProfile>({
    id: 'panda',
    name: 'Panda',
    tone: 'Friendly',
    accentColor: '#f97316',
  })

  const value = useMemo(() => ({ profile, setProfile, tutor, setTutor }), [profile, tutor])

  return <TutorContext.Provider value={value}>{children}</TutorContext.Provider>
}

export const useTutor = () => {
  const context = useContext(TutorContext)
  if (!context) {
    throw new Error('useTutor must be used within TutorProvider')
  }
  return context
}
