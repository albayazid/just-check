"use client";

/**
 * Account Settings Page
 * Allows users to view and edit their profile information.
 * Integrates with Clerk for authentication, avatar management, and password changes.
 */

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useUser, useReverification } from "@clerk/nextjs";
import { useMutation } from "@tanstack/react-query";
import { isClerkRuntimeError, isReverificationCancelledError } from "@clerk/nextjs/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useProfile, useUpdateProfile, useUploadAvatar } from "@/hooks/use-profile";
import { validatePasswordStrength } from "@/lib/password-validation";
import { Eye, EyeOff, Lock, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function AccountSettingsPageClient() {
  // Clerk authentication hook - provides current user data
  const { user, isLoaded: userLoaded } = useUser();
  const router = useRouter();

  // Custom hooks for profile data fetching and updates
  const { data: profile, isLoading: profileLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();

  // Delete account mutation
  const deleteWithReverification = useReverification(async () => {
    if (!user) throw new Error("No user found");
    await user.delete();
  });

  const deleteAccount = useMutation({
    mutationFn: async () => {
      await deleteWithReverification();
    },
    onSuccess: () => {
      setShowDeleteDialog(false);
      router.push("/sign-in");
    },
    onError: (error) => {
      if (isClerkRuntimeError(error) && isReverificationCancelledError(error)) {
        toast.info("Verification cancelled", {
          description: "You need to verify your identity to delete your account. Please try again.",
        });
        return;
      }
      toast.error("Failed to delete account", {
        description: error instanceof Error ? error.message : "Please try again or contact support.",
      });
    },
  });

  // Ref for the hidden file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ref to track if form has been initialized from profile data
  // Prevents overwriting user edits when profile data refetches
  const initializedRef = useRef(false);

  // Form state for profile fields
  const [formData, setFormData] = useState({
    fullName: '',
    nickname: '',
    dateOfBirth: '',
  });

  // Password change form state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    signOutOfOtherSessions: true,
  });

  // Password visibility toggles
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Loading state for password change
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Modal open state for password dialog
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  // Modal open state for delete account dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Check if user has a password set (not OAuth-only)
  const hasPassword = user?.passwordEnabled ?? false;

  // Set up reverification for OAuth users setting a password
  // This handles the email/phone OTP verification flow automatically
  const setPasswordWithReverification = useReverification(
    async (newPassword: string, signOutOfOtherSessions: boolean) => {
      if (!user) throw new Error('User not available');
      if (!newPassword || typeof newPassword !== 'string') {
        throw new Error('Valid password is required');
      }
      if (typeof signOutOfOtherSessions !== 'boolean') {
        throw new Error('signOutOfOtherSessions must be a boolean');
      }
      return user.updatePassword({
        newPassword,
        signOutOfOtherSessions,
      });
    }
  );



  /**
   * Initialize form data from profile when it first loads
   * Uses a ref flag to ensure we only populate the form once
   * to avoid overwriting user input on subsequent profile updates
   */
  useEffect(() => {
    if (profile && !initializedRef.current) {
      initializedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({
        fullName: profile.full_name ?? '',
        nickname: profile.nickname ?? '',
        dateOfBirth: profile.date_of_birth ?? '',
      });
    }
  }, [profile]);

  /**
   * Handle form submission
   * Updates the profile via the useUpdateProfile mutation
   * Shows success/error toast notifications
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate full name has at least 2 words
    const fullNameParts = formData.fullName.trim().split(/\s+/);
    if (fullNameParts.length < 2) {
      toast.error('Validation failed', {
        description: 'Full name must contain at least 2 words (first name and last name)',
      });
      return;
    }

    try {
      await updateProfile.mutateAsync({
        full_name: formData.fullName,
        nickname: formData.nickname,
        date_of_birth: formData.dateOfBirth || undefined,
      });
      toast.success('Profile updated successfully');
      // Reset initialization flag to allow re-initialization if profile changes from outside
      initializedRef.current = false;
    } catch (error) {
      toast.error('Failed to update profile', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  };

  /**
   * Handle input field changes
   * Updates the formData state for the specified field
   */
  const handleChange = (field: keyof typeof formData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  /**
   * Handle avatar file selection
   * Validates and uploads the selected file to Clerk
   */
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type', {
        description: 'Please select a JPEG, PNG, WebP, or GIF image.',
      });
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large', {
        description: 'Maximum file size is 5MB.',
      });
      return;
    }

    try {
      await uploadAvatar.mutateAsync(file);
      toast.success('Profile picture uploaded!', {
        description: 'It will appear on your profile shortly.',
      });
    } catch (error) {
      toast.error('Failed to upload profile picture', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }

    // Reset the input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Handle password change form submission
   * For users with existing passwords: uses Clerk's updatePassword with currentPassword
   * For OAuth users: uses useReverification hook which handles email/phone OTP verification
   */
  const handlePasswordChange = async () => {
    // Validate current password is provided (only for users who have a password)
    if (hasPassword && !passwordForm.currentPassword) {
      toast.error('Current password required', {
        description: 'Please enter your current password to verify your identity.',
      });
      return;
    }

    // Validate new password strength
    const strengthCheck = validatePasswordStrength(passwordForm.newPassword);
    if (!strengthCheck.isValid) {
      const unmetRequirements = strengthCheck.requirements
        .filter(r => !r.met)
        .map(r => r.label)
        .join(', ');
      toast.error('Password does not meet requirements', {
        description: `Missing: ${unmetRequirements}`,
      });
      return;
    }

    // Validate passwords match
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Passwords do not match', {
        description: 'Please ensure your new password and confirmation match.',
      });
      return;
    }

    // Validate new password is different from current (only for users with existing password)
    if (hasPassword && passwordForm.currentPassword === passwordForm.newPassword) {
      toast.error('New password must be different', {
        description: 'Your new password cannot be the same as your current password.',
      });
      return;
    }

    setIsChangingPassword(true);

    try {
      if (hasPassword) {
        // User has existing password - use frontend method with currentPassword verification
        if (!user) {
          throw new Error('User object is not available');
        }
        await user.updatePassword({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
          signOutOfOtherSessions: passwordForm.signOutOfOtherSessions,
        });
      } else {
        // OAuth user setting password for the first time - use client-side approach with reverification
        // The useReverification hook handles the email/phone OTP verification flow automatically
        await setPasswordWithReverification(
          passwordForm.newPassword,
          passwordForm.signOutOfOtherSessions
        );
      }

      toast.success(hasPassword ? 'Password changed successfully' : 'Password set successfully', {
        description: passwordForm.signOutOfOtherSessions
          ? 'You have been signed out of all other devices.'
          : hasPassword
            ? 'Your password has been updated.'
            : 'You can now sign in with your email and password.',
      });

      // Reset password form
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        signOutOfOtherSessions: true,
      });
      
      // Close the modal
      setIsPasswordModalOpen(false);
    } catch (error) {
      // Handle reverification cancelled (user closed the verification modal)
      if (isClerkRuntimeError(error) && isReverificationCancelledError(error)) {
        toast.info('Verification cancelled', {
          description: 'You need to verify your identity to set a password. Please try again.',
        });
        return;
      }

      // Handle other errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      toast.error(hasPassword ? 'Failed to change password' : 'Failed to set password', {
        description: errorMessage,
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Memoize password validation to avoid re-running on every render
  const passwordValidation = useMemo(
    () => validatePasswordStrength(passwordForm.newPassword),
    [passwordForm.newPassword]
  );

  // Combined loading state from multiple sources
  const isLoading = profileLoading || !userLoaded || updateProfile.isPending;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Account Settings</h1>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Profile Picture Section */}
          {/* Users can upload their profile picture directly to Clerk */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center gap-4">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleAvatarChange}
                  className="hidden"
                  id="avatar-upload"
                />
                
                {/* Avatar with click-to-upload */}
                <div className="relative group">
                  <Avatar className="size-24 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    {userLoaded && user?.imageUrl ? (
                      <AvatarImage src={user.imageUrl} alt="Profile picture" />
                    ) : (
                      <AvatarFallback>
                        <Skeleton className="size-full" />
                      </AvatarFallback>
                    )}
                  </Avatar>
                  
                  {/* Upload overlay on hover */}
                  <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                       onClick={() => fileInputRef.current?.click()}>
                    <span className="text-white text-xs font-medium">Upload</span>
                  </div>
                  
                  {/* Loading overlay */}
                  {uploadAvatar.isPending && (
                    <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    Click on your profile picture to upload a new one
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supports JPEG, PNG, WebP, GIF (max 5MB)
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Profile Information */}
          {/* Editable fields: full name, nickname, date of birth */}
          {/* Email is read-only as it's managed through Clerk */}
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  {isLoading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <Input
                      id="fullName"
                      value={formData.fullName}
                      onChange={(e) => handleChange('fullName', e.target.value)}
                      placeholder="Enter your full name (e.g., John Doe)"
                      required
                      minLength={2}
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nickname">Nickname</Label>
                  {isLoading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <Input
                      id="nickname"
                      value={formData.nickname}
                      onChange={(e) => handleChange('nickname', e.target.value)}
                      placeholder="Enter your nickname"
                      required
                      minLength={2}
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dateOfBirth">Date of Birth</Label>
                  {isLoading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <Input
                      id="dateOfBirth"
                      type="date"
                      value={formData.dateOfBirth}
                      onChange={(e) => handleChange('dateOfBirth', e.target.value)}
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  {isLoading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <Input
                      id="email"
                      type="email"
                      value={profile?.email || user?.emailAddresses?.[0]?.emailAddress || ""}
                      readOnly
                      className="bg-muted"
                    />
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button
                  type="submit"
                  disabled={isLoading || updateProfile.isPending}
                >
                  {updateProfile.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Password Action Section */}
          {/* Shows either Set Password or Update Password button based on password status */}
          <Card>
            <CardHeader>
              <CardTitle>Password Action</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    {hasPassword
                      ? 'Your account is protected with a password.'
                      : 'You haven\'t set a password yet. Set one to enable email/password login.'}
                  </p>
                </div>
                
                <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
                  <DialogTrigger asChild>
                    <Button type="button" variant="outline">
                      {hasPassword ? 'Update Password' : 'Set Password'}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Lock className="w-5 h-5" />
                        {hasPassword ? 'Update Password' : 'Set Password'}
                      </DialogTitle>
                      <DialogDescription>
                        {hasPassword
                          ? 'Enter your current password and a new password to update your credentials.'
                          : 'Create a password to enable email/password login for your account. You will be asked to verify your identity via email or phone code.'}
                      </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-4">
                      {/* Current Password - only shown for users with existing passwords */}
                      {hasPassword && (
                        <div className="space-y-2">
                          <Label htmlFor="currentPassword">Current Password</Label>
                          <div className="relative">
                            <Input
                              id="currentPassword"
                              type={showCurrentPassword ? 'text' : 'password'}
                              value={passwordForm.currentPassword}
                              onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                              placeholder="Enter your current password"
                              disabled={isChangingPassword}
                              className="pr-10"
                            />
                            <button
                              type="button"
                              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                              tabIndex={-1}
                            >
                              {showCurrentPassword ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* New Password */}
                      <div className="space-y-2">
                        <Label htmlFor="newPassword">{hasPassword ? 'New Password' : 'Password'}</Label>
                        <div className="relative">
                          <Input
                            id="newPassword"
                            type={showNewPassword ? 'text' : 'password'}
                            value={passwordForm.newPassword}
                            onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                            placeholder={hasPassword ? 'Enter your new password' : 'Enter a password'}
                            disabled={isChangingPassword}
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            tabIndex={-1}
                          >
                            {showNewPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>

                        {/* Password Strength Requirements */}
                        {passwordForm.newPassword && (
                          <div className="space-y-1 mt-2">
                            <p className="text-xs font-medium text-muted-foreground">Password requirements:</p>
                            {passwordValidation.requirements.map((req, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-xs">
                                <div className={`w-1.5 h-1.5 rounded-full ${req.met ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                                <span className={req.met ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
                                  {req.label}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Confirm New Password */}
                      <div className="space-y-2">
                        <Label htmlFor="confirmPassword">{hasPassword ? 'Confirm New Password' : 'Confirm Password'}</Label>
                        <div className="relative">
                          <Input
                            id="confirmPassword"
                            type={showConfirmPassword ? 'text' : 'password'}
                            value={passwordForm.confirmPassword}
                            onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                            placeholder={hasPassword ? 'Confirm your new password' : 'Confirm your password'}
                            disabled={isChangingPassword}
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            tabIndex={-1}
                          >
                            {showConfirmPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        {passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && (
                          <p className="text-xs text-destructive">Passwords do not match</p>
                        )}
                      </div>

                      {/* Sign out of other sessions checkbox */}
                      <div className="flex items-start space-x-2 pt-2">
                        <Checkbox
                          id="signOutOfOtherSessions"
                          checked={passwordForm.signOutOfOtherSessions}
                          onCheckedChange={(checked) =>
                            setPasswordForm(prev => ({ ...prev, signOutOfOtherSessions: checked as boolean }))
                          }
                          disabled={isChangingPassword}
                        />
                        <div className="grid gap-1.5 leading-none">
                          <Label
                            htmlFor="signOutOfOtherSessions"
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                          >
                            Sign out of all other devices
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            This will sign you out of all other active sessions for security.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsPasswordModalOpen(false)}
                        disabled={isChangingPassword}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={handlePasswordChange}
                        disabled={isChangingPassword}
                      >
                        {isChangingPassword ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {hasPassword ? 'Updating...' : 'Setting...'}
                          </>
                        ) : (
                          hasPassword ? 'Update Password' : 'Set Password'
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="font-medium text-destructive">Delete Account</h3>
                <p className="text-sm text-destructive">
                  Permanently delete your account and all associated data. This action cannot be undone.
                </p>
                <Button variant="destructive" type="button" onClick={() => setShowDeleteDialog(true)}>
                  Delete Account
                </Button>
              </div>
            </CardContent>
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
                    "Delete Account"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </form>
    </div>
  );
}
