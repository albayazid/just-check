"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";
import { useUsage } from "@/hooks/use-usage";
import { useSubscription } from "@/hooks/use-subscription";
import { getPlanDisplayName } from "@/lib/subscription-utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

export default function UsagePage() {
  const { data: usageData, isLoading: usageLoading, error: usageError, isFetching: isUsageFetching } = useUsage();
  const { data: subscriptionData, isLoading: subscriptionLoading, error: subscriptionError } = useSubscription();
  const queryClient = useQueryClient();
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showUncancelDialog, setShowUncancelDialog] = useState(false);
  const [showUpdatePaymentDialog, setShowUpdatePaymentDialog] = useState(false);

  // Cancel subscription mutation
  const cancelSubscriptionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/subscription/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cancelAtNextBillingDate: true }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to cancel subscription');
      }
      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch subscription data
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      setShowCancelDialog(false);
    },
  });

  // Uncancel subscription mutation
  const uncancelSubscriptionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/subscription/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cancelAtNextBillingDate: false }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || 'Failed to uncancel subscription');
      }
      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch subscription data
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      setShowUncancelDialog(false);
      toast.success('Subscription reactivated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reactivate subscription. Please try again.');
    },
  });

  // Update payment method mutation (for on_hold subscriptions)
  const updatePaymentMethodMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/subscription/update-payment-method', {
        method: 'POST',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update payment method');
      }
      return response.json();
    },
  });

  // Format date range with time
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Determine badge variant based on subscription status
  const getBadgeVariant = (status: string) => {
    switch (status) {
      case 'active':
        return 'default'; // green
      case 'trialing':
      case 'on_hold':
      case 'incomplete':
        return 'secondary'; // yellow/orange
      case 'past_due':
      case 'cancelled':
      case 'unpaid':
        return 'destructive'; // red
      default:
        return 'outline'; // gray for inactive/unknown
    }
  };

  // Determine progress bar color
  const getBarColor = (percentage: number) => {
    return percentage <= 20 ? 'bg-yellow-500' : 'bg-primary';
  };

  // Calculate scale for >100% cases
  const getScaleInfo = (percentage: number) => {
    if (percentage <= 100) {
      return { leftLabel: '0%', rightLabel: '100%', barWidth: percentage, showScaled100: false };
    }
    // For >100%, scale the 100% marker inward
    const scaled100Pos = Math.round((100 / percentage) * 100);
    // Hide marker if it would overlap with edge labels (within 5% of either edge)
    const showScaled100 = scaled100Pos > 5 && scaled100Pos < 95;
    // If marker is hidden, show "0 to 100%" on left to indicate scale
    const leftLabel = showScaled100 ? '0%' : '0-100%';
    return {
      leftLabel,
      rightLabel: `${Math.round(percentage)}%`,
      barWidth: 100,
      showScaled100,
      scaled100Pos,
    };
  };

  const isLoading = usageLoading || subscriptionLoading;
  const error = usageError || subscriptionError;

  if (isLoading) {
    return (
      <>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Usage</h1>
        </div>

        {/* Current Plan and Upgrade Cards Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Current Plan Card Skeleton */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Skeleton className="h-5 w-32" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-2">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-4 w-48" />
            </CardContent>
          </Card>

          {/* Upgrade Card Skeleton */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Skeleton className="h-5 w-32" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>

        {/* Monthly Allowance Card Skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32 mb-2" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-3 w-full" />
              <div className="flex justify-between">
                <Skeleton className="h-3 w-8" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Usage</h1>
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-red-500">Failed to load data</div>
          </CardContent>
        </Card>
      </>
    );
  }

  const percentage = usageData?.remainingPercentage ?? 0;
  const scaleInfo = getScaleInfo(percentage);
  const barColor = getBarColor(percentage);

  // Determine next reset message
  const getNextResetMessage = () => {
    if (!usageData?.periodEnd) return "No active daily allowance";
    const periodEnd = new Date(usageData.periodEnd);
    const now = new Date();
    if (now > periodEnd) {
      return "Daily allowance refreshes at midnight UTC.";
    }
    return `Next reset: ${formatDate(usageData.periodEnd)}`;
  };

  return (
    <>
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Usage</h1>
      </div>

      {/* Current Plan and Upgrade Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Current Plan Card */}
        <Card>
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-lg font-semibold">
                {subscriptionData?.planId ? getPlanDisplayName(subscriptionData.planId) : 'Free'}
              </div>
              {subscriptionData?.status && (
                <Badge variant={getBadgeVariant(subscriptionData.status)} className="capitalize">
                  {subscriptionData.status}
                </Badge>
              )}
              {subscriptionData?.cancelAtPeriodEnd && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">
                  Scheduled to Cancel
                </Badge>
              )}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {formatDate(subscriptionData?.currentPeriodStart)} - {formatDate(subscriptionData?.currentPeriodEnd)}
            </div>
            {/* Cancel subscription button - subtle styling */}
            {subscriptionData && !subscriptionData.cancelAtPeriodEnd && (
              <div className="mt-4 pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCancelDialog(true)}
                  disabled={cancelSubscriptionMutation.isPending}
                  className="text-muted-foreground hover:text-destructive hover:border-destructive"
                >
                  Cancel Subscription
                </Button>
              </div>
            )}
            {/* Show cancelled status if already set to cancel */}
            {subscriptionData?.cancelAtPeriodEnd && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm text-destructive mb-3">
                  Your subscription has been cancelled and will end on {formatDate(subscriptionData?.currentPeriodEnd)}. It will not renew automatically.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowUncancelDialog(true)}
                  disabled={uncancelSubscriptionMutation.isPending}
                  className="text-muted-foreground hover:text-primary hover:border-primary"
                >
                  Uncancel Subscription
                </Button>
              </div>
            )}
            {/* Update payment method section for on_hold subscriptions */}
            {subscriptionData?.status === 'on_hold' && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm text-amber-500 mb-3 font-medium">
                  Your subscription is on hold due to a payment issue. Update your payment method to regain access immediately.
                </p>
                <Button
                  size="sm"
                  onClick={() => setShowUpdatePaymentDialog(true)}
                  disabled={updatePaymentMethodMutation.isPending}
                >
                  {updatePaymentMethodMutation.isPending ? 'Processing...' : 'Update Payment Method'}
                </Button>
              </div>
            )}

            {/* Cancel Confirmation Dialog */}
            <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Are you sure?</DialogTitle>
                  <DialogDescription>
                    Are you sure you want to cancel your subscription? You will retain access until the end of the current billing period ({formatDate(subscriptionData?.currentPeriodEnd)}).
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => cancelSubscriptionMutation.mutate()}
                    disabled={cancelSubscriptionMutation.isPending}
                  >
                    {cancelSubscriptionMutation.isPending ? 'Cancelling...' : 'Yes, Cancel'}
                  </Button>
                  <Button
                    onClick={() => setShowCancelDialog(false)}
                    disabled={cancelSubscriptionMutation.isPending}
                    autoFocus
                  >
                    Keep Subscription
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Uncancel Confirmation Dialog */}
            <Dialog open={showUncancelDialog} onOpenChange={setShowUncancelDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reactivate Subscription</DialogTitle>
                  <DialogDescription>
                    Are you sure you want to reactivate your subscription? It will continue to renew automatically on {formatDate(subscriptionData?.currentPeriodEnd)}.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setShowUncancelDialog(false)}
                    disabled={uncancelSubscriptionMutation.isPending}
                  >
                    Keep Cancelled
                  </Button>
                  <Button
                    onClick={() => uncancelSubscriptionMutation.mutate()}
                    disabled={uncancelSubscriptionMutation.isPending}
                    autoFocus
                  >
                    {uncancelSubscriptionMutation.isPending ? 'Reactivating...' : 'Yes, Reactivate'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Update Payment Method Confirmation Dialog */}
            <Dialog open={showUpdatePaymentDialog} onOpenChange={setShowUpdatePaymentDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Update Payment Method</DialogTitle>
                  <DialogDescription>
                    You will be redirected to a secure page to update your payment method. This will also reactivate your subscription.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setShowUpdatePaymentDialog(false)}
                    disabled={updatePaymentMethodMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      try {
                        const result = await updatePaymentMethodMutation.mutateAsync();
                        if (result.payment_link) {
                          window.location.href = result.payment_link;
                        }
                      } catch (error) {
                        console.error('Failed to update payment method:', error);
                        toast.error('Failed to initiate payment method update. Please try again.');
                        setShowUpdatePaymentDialog(false);
                      }
                    }}
                    disabled={updatePaymentMethodMutation.isPending}
                  >
                    {updatePaymentMethodMutation.isPending ? 'Processing...' : 'Continue'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        {/* Upgrade Card */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Upgrade Plan</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 space-y-4">
            <ul className="space-y-2 text-sm">
              <li className="flex items-start">
                <span className="mr-2 text-primary">•</span>
                <span>Extended message history</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-primary">•</span>
                <span>Faster response times</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-primary">•</span>
                <span>Priority support</span>
              </li>
            </ul>

            <Link href="/upgrade" passHref className="block mt-auto">
              <Button className="w-full">
                Upgrade to Higher Plan
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Allowance Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Daily Allowance</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['usage'] })}
              disabled={isUsageFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isUsageFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <CardDescription>
            Track your allowance for daily window
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Remaining Allowance</span>
              <span className="text-sm font-medium">{percentage}%</span>
            </div>

            {/* Progress Bar with dynamic color and scaling */}
            <div className="w-full bg-muted rounded-full h-3 relative">
              <div
                className={`h-3 rounded-full transition-all duration-300 ease-in-out ${barColor}`}
                style={{ width: `${scaleInfo.barWidth}%` }}
              ></div>
              {/* Scaled 100% marker for >100% cases */}
              {scaleInfo.showScaled100 && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-primary-foreground/60"
                  style={{ left: `${scaleInfo.scaled100Pos}%` }}
                  title="100% of original allowance"
                ></div>
              )}
            </div>

            <div className="flex justify-between text-xs text-muted-foreground relative">
              <span>{scaleInfo.leftLabel}</span>
              <span>{scaleInfo.rightLabel}</span>
              {/* Position the 100% marker at the scaled position for >100% */}
              {scaleInfo.showScaled100 && (
                <span
                  className="absolute"
                  style={{ left: `${scaleInfo.scaled100Pos}%`, transform: 'translateX(-50%)' }}
                >
                  100%
                </span>
              )}
            </div>

            {/* Next reset time - subtle muted text */}
            <div className="text-xs text-muted-foreground mt-2">
              {getNextResetMessage()}
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
