'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth, useUser, useClerk } from '@clerk/nextjs'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AlertCircle, User, Calendar, Globe, Loader2, Menu, LogOut, Trash2 } from 'lucide-react'
import { validateAge } from '@/lib/age-validation'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface FormData {
  fullName: string
  nickname: string
  dateOfBirth: string
}

// TODO: Add avatar update option later with proper infrastructure and system

interface FormErrors {
  [key: string]: string
}

function OnboardingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isLoaded, isSignedIn, getToken, sessionClaims } = useAuth()
  const { user } = useUser()
  const { signOut } = useClerk()
  const isOnboarded = !!((sessionClaims?.publicMetadata as { profileComplete?: boolean } | undefined)?.profileComplete)

  const [formData, setFormData] = useState<FormData>({
    fullName: '',
    nickname: '',
    dateOfBirth: '',
  })

  const [errors, setErrors] = useState<FormErrors>({})
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const deleteAccount = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('No user found')
      await user.delete()
    },
    onSuccess: () => {
      setShowDeleteDialog(false)
      router.push('/sign-in')
    },
  })

  // Pre-fill form with Clerk data if available
  useEffect(() => {
    if (user) {
      const fullName = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim()
      setFormData(prev => ({
        ...prev,
        fullName: fullName || '',
      }))
    }
  }, [user])

  // Redirect if not authenticated
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push('/sign-in')
    }
  }, [isLoaded, isSignedIn, router])

  // Redirect once onboarding is complete (user object confirms it)
  useEffect(() => {
    if (isOnboarded) {
      const returnUrl = searchParams.get('returnUrl') || '/'
      router.push(returnUrl)
    }
  }, [isOnboarded, searchParams, router])

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  const completeOnboarding = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (!response.ok) throw new Error('Failed to complete onboarding')
      return response.json()
    },
    onSuccess: async () => {
      const returnUrl = searchParams.get('returnUrl') || '/'
      try {
        // Force a fresh JWT — updates sessionClaims (client) and __session cookie (middleware) atomically
        await getToken({ skipCache: true })
        // Redirect fires reactively via the useEffect when sessionClaims updates
        //
        // NOTE: user.reload() also works here — it refreshes BOTH the JWT AND the user object.
        // We use getToken because isOnboarded reads from sessionClaims, and getToken is the lighter call
        // (one token request vs. token + user fetch).
      } catch {
        // Fallback: hard navigation if token refresh fails
        window.location.href = returnUrl
      }
    },
    onError: () => {
      setIsSubmitting(false)
    }
  })

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

    if (!formData.fullName.trim()) {
      newErrors.fullName = 'Full name is required'
    } else if (formData.fullName.trim().length < 2) {
      newErrors.fullName = 'Full name must be at least 2 characters'
    } else {
      const nameParts = formData.fullName.trim().split(/\s+/)
      if (nameParts.length < 2) {
        newErrors.fullName = 'Full name must contain at least 2 words (first name and last name)'
      }
    }

    if (!formData.nickname.trim()) {
      newErrors.nickname = 'Nickname is required'
    } else if (formData.nickname.trim().length < 2) {
      newErrors.nickname = 'Nickname must be at least 2 characters'
    }

    if (!formData.dateOfBirth) {
      newErrors.dateOfBirth = 'Date of birth is required'
    } else {
      const ageValidation = validateAge(formData.dateOfBirth, 13, 150)
      if (!ageValidation.isValid) {
        newErrors.dateOfBirth = ageValidation.error || 'Invalid date of birth'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (validateForm()) {
      setIsSubmitting(true)
      completeOnboarding.mutate(formData)
    }
  }

  // Show loading while auth is loading
  if (!isLoaded) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    )
  }

  // Don't render if not signed in (redirect will happen)
  if (!isSignedIn) {
    return null
  }

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl relative">
        <div className="absolute left-4 top-4 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground opacity-50 hover:opacity-100"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => signOut({ redirectUrl: '/sign-in' })}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowDeleteDialog(true)}
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Account
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback>
                <User className="h-8 w-8" />
              </AvatarFallback>
            </Avatar>
          </div>
          <CardTitle className="text-2xl font-bold">Complete Your Profile</CardTitle>
          <CardDescription>
            Please provide the following information to access your account
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            {/* Full Name */}
            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-sm font-medium">
                Full Name *
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder="Enter your full name (e.g., John Doe)"
                value={formData.fullName}
                onChange={(e) => handleInputChange('fullName', e.target.value)}
                className={errors.fullName ? 'border-destructive' : ''}
                disabled={isSubmitting}
              />
              {errors.fullName && (
                <div className="flex items-center text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  {errors.fullName}
                </div>
              )}
            </div>

            {/* Nickname */}
            <div className="space-y-2">
              <Label htmlFor="nickname" className="text-sm font-medium">
                Nickname *
              </Label>
              <Input
                id="nickname"
                type="text"
                placeholder="What should we call you?"
                value={formData.nickname}
                onChange={(e) => handleInputChange('nickname', e.target.value)}
                className={errors.nickname ? 'border-destructive' : ''}
                disabled={isSubmitting}
              />
              {errors.nickname && (
                <div className="flex items-center text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  {errors.nickname}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                This name will be used for short references.
              </p>
            </div>

            {/* Date of Birth */}
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth" className="text-sm font-medium flex items-center">
                <Calendar className="h-4 w-4 mr-1" />
                Date of Birth *
              </Label>
              <Input
                id="dateOfBirth"
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                className={errors.dateOfBirth ? 'border-destructive' : ''}
                disabled={isSubmitting}
              />
              {errors.dateOfBirth && (
                <div className="flex items-center text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  {errors.dateOfBirth}
                </div>
              )}
            </div>



            {/* Error Message */}
            {completeOnboarding.error && (
              <div className="text-sm text-center p-3 rounded-md text-destructive bg-destructive/10 border border-destructive/20">
                {completeOnboarding.error.message}
              </div>
            )}
          </CardContent>

          <CardFooter className="flex items-center justify-end mt-4">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                  Saving Profile...
                </div>
              ) : (
                'Complete Profile'
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Delete Account Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Account
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete your account? This action cannot be undone and all your data will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleteAccount.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteAccount.mutate()}
              disabled={deleteAccount.isPending}
            >
              {deleteAccount.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Account'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// The current edit to this file and respective git commit is to avoid a build error.
// TODO: Investigate and learn what was causing the build error in this file even if it was a client file.
export default function OnboardingPageClient() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    }>
      <OnboardingContent />
    </Suspense>
  )
}
