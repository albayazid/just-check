'use client';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, ArrowLeft, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOnboardedAuth } from "@/hooks/use-onboarded-auth";
import { APP_BRAND_LOGO_URL, APP_BRAND_NAME } from "@/lib/branding-constants";
import { useState, useEffect } from "react";
import { useSubscription } from "@/hooks/use-subscription";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PRODUCT_IDS, getPlanDisplayName } from "@/lib/subscription-utils";
import { toast } from "sonner";

// Pricing plan interface defining the structure for each plan card
interface PricingPlan {
  name: string;           // Plan name (Free, Go, Plus, Pro)
  description: string;    // Short description of the plan
  price: string;          // Display price (e.g., "$10/month")
  features: string[];     // List of features included
  buttonText: string;     // Button text for this plan
  highlight?: boolean;    // Whether to highlight this plan (e.g., "Most Popular")
  badge?: string;         // Optional badge text (e.g., "Most Popular")
  productId?: string;     // DODO product ID for checkout/upgrade
}

const pricingPlans: PricingPlan[] = [
  {
    name: "Free",
    description: "Explore Lumy at no cost.",
    price: "$0/month",
    features: [
      "AI-powered conversations",
      "Essential features included",
      "Limited monthly usage",
      "Standard response speed",
      "Up to 2 folders",
      "Community support",
    ],
    buttonText: "Get Started",
  },
  {
    name: "Go",
    description: "Everyday smarts. Effortless flow.",
    price: "$5/month",
    features: [
      "AI-powered conversations",
      "Expanded usage to keep going",
      "More features unlocked",
      "Up to 10 folders",
      "Standard response speed",
      "Community support",
    ],
    buttonText: "Choose Go",
    productId: PRODUCT_IDS.GO_MONTHLY,
  },
  {
    name: "Plus",
    description: "Power that keeps up with your thinking.",
    price: "$20/month",
    features: [
      "Advanced AI capabilities",
      "Generous usage allowance",
      "Full feature library",
      "Up to 50 folders",
      "Early access to new tools",
      "Priority response speed",
      "Priority support",
    ],
    buttonText: "Choose Plus",
    highlight: true,
    badge: "Most Popular",
    productId: PRODUCT_IDS.PLUS_MONTHLY,
  },
  {
    name: "Pro",
    description: "Everything. Uncompromised.",
    price: "$100/month",
    features: [
      "Advanced AI capabilities",
      "Near-unlimited usage",
      "Every feature, unlocked",
      "Up to 200 folders",
      "All experimental tools",
      "Fastest response speed",
      "Priority support",
    ],
    buttonText: "Choose Pro",
    productId: PRODUCT_IDS.PRO_MONTHLY,
  },
];

/**
 * Handles checkout for new subscriptions (users without existing subscription)
 * Creates DODO customer and redirects to checkout session
 */
async function handleCheckout(productId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Checkout API automatically handles customer creation/retrieval
    const checkoutResponse = await fetch(
      `/api/checkout?productId=${productId}`,
      {
        method: 'GET',
      }
    );

    if (!checkoutResponse.ok) {
      const errorData = await checkoutResponse.json();
      
      // Handle 409 Conflict - user already has subscription
      if (checkoutResponse.status === 409) {
        return { 
          success: false, 
          error: errorData.message || 'You already have an active subscription. Please use the upgrade option instead.' 
        };
      }
      
      return { success: false, error: errorData.error || 'Failed to create checkout session' };
    }

    const data = await checkoutResponse.json();

    if (data.checkout_url) {
      // Redirect user to DODO checkout page
      window.location.href = data.checkout_url;
      return { success: true };
    } else {
      return { success: false, error: 'No checkout URL returned' };
    }
  } catch (error) {
    console.error('Checkout error:', error);
    return { success: false, error: 'Failed to initiate checkout. Please try again.' };
  }
}

export default function UpgradePageClient() {
  const router = useRouter();
  const { isSignedIn, isSignedInAndOnboarded, isOnboarded } = useOnboardedAuth();
  const { data: subscription } = useSubscription(isSignedInAndOnboarded);  // Only fetch when signed in and onboarded
  const queryClient = useQueryClient();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [showUncancelDialog, setShowUncancelDialog] = useState(false);
  const [pendingPlanAfterUncancel, setPendingPlanAfterUncancel] = useState<PricingPlan | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PricingPlan | null>(null);
  const [previewData, setPreviewData] = useState<{
    immediateCharge: number;
    currency: string;
    newPlan: any;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      setShowUncancelDialog(false);
      
      // If there's a pending plan after uncancel, proceed to show confirmation dialog
      if (pendingPlanAfterUncancel) {
        setSelectedPlan(pendingPlanAfterUncancel);
        setShowConfirmDialog(true);
        setPendingPlanAfterUncancel(null);
      } else {
        // Otherwise refresh the page to update subscription data
        window.location.reload();
      }
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'Failed to reactivate subscription. Please try again.');
      setShowUncancelDialog(false);
      setPendingPlanAfterUncancel(null);
    },
  });

  // Determine current plan ID from subscription (default to 'free' if none)
  const currentPlanId = subscription?.planId || 'free';

  // EFFECT: Fetch preview data when confirmation dialog opens
  useEffect(() => {
    if (showConfirmDialog && selectedPlan) {
      fetchPreviewData();
    }
  }, [showConfirmDialog, selectedPlan]);

  /**
   * Fetches plan change preview from Dodo API
   * Shows the immediate charge and new plan details
   */
  const fetchPreviewData = async () => {
    try {
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewData(null);

      if (!selectedPlan?.productId) {
        setPreviewError('No product ID available for selected plan');
        setPreviewLoading(false);
        return;
      }

      const response = await fetch('/api/subscription/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId: selectedPlan.productId }),
      });

      if (response.ok) {
        const data = await response.json();
        setPreviewData({
          immediateCharge: data.immediateCharge || 0,
          currency: data.currency || 'USD',
          newPlan: data.newPlan || null,
        });
      } else {
        const errorData = await response.json();
        setPreviewError(errorData.error || 'Failed to load plan preview');
      }
    } catch (error) {
      console.error('Failed to fetch preview:', error);
      setPreviewError('Network error while loading preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  /**
   * Handles subscription upgrade/change for existing subscribers
   * Calls the update API which uses Dodo's automatic proration
   */
  const handleUpdateSubscription = async (productId: string) => {
    try {
      setLoadingPlan(selectedPlan?.name || null);
      setErrorMessage(null);
      const response = await fetch('/api/subscription/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        
        // Handle 403 - subscription scheduled for cancellation or no active subscription
        if (response.status === 403) {
          throw new Error(errorData.message || errorData.error || 'Cannot upgrade subscription');
        }
        
        throw new Error(errorData.error || 'Failed to update subscription');
      }

      await response.json();

      // Show success dialog
      setShowConfirmDialog(false);
      setPreviewData(null);
      setPreviewError(null);
      setShowSuccessDialog(true);
    } catch (error) {
      console.error('Update error:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update subscription. Please try again.');
    } finally {
      setLoadingPlan(null);
    }
  };

  /**
   * Handles plan card button clicks
   * Routes based on user's current subscription status:
   * - Clicking current plan: redirect to home
   * - Existing subscriber changing plan: show confirmation dialog
   * - New user (free/no subscription): redirect to checkout
   * - Not authenticated: show alert
   */
  const handlePlanClick = (plan: PricingPlan) => {
    // Check if subscription is scheduled to cancel
    const isScheduledToCancel = subscription?.cancelAtPeriodEnd;
    
    if (plan.productId === currentPlanId) {
      // User clicked their current plan
      if (isScheduledToCancel) {
        // Show uncancel dialog instead of going to app
        setShowUncancelDialog(true);
      } else {
        // Go to app
        window.location.href = '/';
      }
    } else if (subscription && subscription.planId !== 'free') {
      // User has an existing paid subscription and wants to change
      if (isScheduledToCancel) {
        // If scheduled to cancel, first show uncancel dialog
        // After uncancel succeeds, proceed to show confirmation dialog
        setPendingPlanAfterUncancel(plan);
        setShowUncancelDialog(true);
      } else {
        // Show confirmation dialog with credit calculation
        setSelectedPlan(plan);
        setShowConfirmDialog(true);
      }
    } else if (plan.productId && isSignedInAndOnboarded) {
      // User is on free plan or no subscription - new checkout flow
      setLoadingPlan(plan.name);
      handleCheckout(plan.productId).then((result) => {
        if (!result.success && result.error) {
          setErrorMessage(result.error);
        }
        setLoadingPlan(null);
      });
    } else if (isSignedIn && !isOnboarded) {
      // Signed in but not onboarded - redirect to onboarding
      router.push('/onboarding?returnUrl=' + encodeURIComponent('/upgrade'));
    } else if (!isSignedIn) {
      // Not signed in - redirect to sign in
      router.push('/sign-in?redirect_url=' + encodeURIComponent('/upgrade'));
    }
  };

  return (
    <>
      <header className="sticky top-0 z-50 shrink-0 bg-background/80 backdrop-blur-md h-header-height text-foreground px-1 sm:px-2 flex items-center border-b border-border">
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-2">
            {/* Back button for navigation */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.back()} // Use router.back() for navigation
              className="p-2 hover:bg-accent hover:text-accent-foreground bg-transparent rounded-lg select-none transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft size={24} />
            </Button>

            {/* Lumy logo and name linking to homepage */}
            <Link href="/" className="flex items-center gap-2 hover:bg-accent hover:text-accent-foreground bg-transparent px-3 py-1.5 rounded-lg select-none transition-colors">
              <Image
                src={APP_BRAND_LOGO_URL}
                alt={`${APP_BRAND_NAME} Logo`}
                width={32}
                height={32}
                className="h-8 w-8"
                priority
              />
              <div className="text-xl text-foreground/90 hover:text-accent-foreground transition-colors cursor-pointer md:text-2xl font-bold">{APP_BRAND_NAME}</div>
            </Link>
          </div>
        </div>
      </header>
      <div className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            The right plan for every idea.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Lumy adapts to how you think - from a spark of curiosity to full creative power. Pick the plan that matches your flow.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {pricingPlans.map((plan) => {
            const isCurrentPlan = plan.productId === currentPlanId;

            return (
              <Card
                key={plan.name}
                className={`relative flex flex-col justify-between ${isCurrentPlan
                  ? "border-primary/80"
                  : plan.highlight
                  ? "border-primary ring-2 ring-primary scale-105"
                  : ""
                  }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 right-0 -mr-3 rounded-full bg-primary px-3 py-1 text-xs font-semibold uppercase text-primary-foreground shadow-md">
                    {plan.badge}
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-2xl font-semibold mb-2">
                    {plan.name}
                  </CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="grow">
                  <div className="text-3xl font-bold mb-4">
                    {plan.price.split("/")[0]}
                    <span className="text-lg font-normal text-muted-foreground">/{plan.price.split("/")[1]}</span>
                  </div>
                  <ul className="space-y-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center text-foreground">
                        <Check className="text-chart-1 mr-2 size-5" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={plan.highlight ? "default" : "outline"}
                    onClick={() => handlePlanClick(plan)}
                    disabled={loadingPlan === plan.name}
                  >
                    {loadingPlan === plan.name ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      isCurrentPlan
                        ? (subscription?.cancelAtPeriodEnd ? "Uncancel" : "Continue to App")
                        : plan.buttonText
                    )}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        <div className="text-center mt-10">
          <p className="text-xs text-muted-foreground">
            Prices shown do not include applicable tax.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            Questions about billing?{" "}
            <Link href="/how-billing-works" className="font-medium text-primary underline-offset-4 hover:underline">
              Learn how it works
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Confirmation Dialog for Subscription Update */}
      {/* Shows when user clicks a different plan card (existing subscriber) */}
      <Dialog open={showConfirmDialog} onOpenChange={(open) => {
        setShowConfirmDialog(open);
        if (!open) {
          setPreviewData(null);
          setPreviewError(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Subscription Plan</DialogTitle>
            <div className="space-y-4">
              {/* Main change summary */}
              <p className="text-muted-foreground text-sm">
                You are about to change your subscription from{" "}
                <span className="font-semibold">{getPlanDisplayName(currentPlanId)}</span> to{" "}
                <span className="font-semibold">{selectedPlan?.name}</span>.
              </p>

              {/* Dodo Preview Section - Shows immediate charge */}
              {previewLoading && (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Loading preview...</span>
                </div>
              )}

              {!previewLoading && previewError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <p className="font-semibold">Preview unavailable</p>
                  <p>{previewError}</p>
                  <p className="mt-1 text-xs">Please try again later. If the problem persists, contact support.</p>
                </div>
              )}

              {!previewLoading && previewData && (
                <div className="space-y-2 rounded-md bg-muted p-3">
                  <p className="text-sm font-medium">Plan Change Preview</p>
                  <div className="text-sm">
                    <span className="text-muted-foreground">New plan:</span>{" "}
                    <span className="font-semibold">{selectedPlan?.name}</span>{" "}
                    <span className="text-muted-foreground">({selectedPlan?.price})</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Immediate charge:</span>{" "}
                    <span className="font-bold text-primary">
                      {(previewData.immediateCharge / 100).toFixed(2)} {previewData.currency}
                    </span>
                  </div>
                </div>
              )}


              {/* Important note about billing */}
              <p className="text-xs text-muted-foreground pt-2 border-t">
                This change will take effect immediately with automatic proration.
              </p>
            </div>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirmDialog(false);
                setPreviewData(null);
                setPreviewError(null);
              }}
              disabled={loadingPlan === selectedPlan?.name}
            >
              Cancel
            </Button>
            <Button
              onClick={() => selectedPlan && handleUpdateSubscription(selectedPlan.productId!)}
              disabled={loadingPlan === selectedPlan?.name || previewLoading || !!previewError || !previewData}
            >
              {loadingPlan === selectedPlan?.name ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : previewLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                "Confirm Change"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success Dialog - Shows after successful upgrade */}
      <Dialog
        open={showSuccessDialog}
        onOpenChange={(open) => {
          setShowSuccessDialog(open);
          // Hard refresh the page when modal closes to ensure all data is fresh
          if (!open) {
            window.location.reload();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-green-600 dark:text-green-400">
              Upgrade Request Successful!
            </DialogTitle>
            <div className="space-y-3 pt-2 text-muted-foreground">
              <p className="text-sm">
                Your subscription has been changed from{" "}
                <span className="font-semibold">{getPlanDisplayName(currentPlanId)}</span> to{" "}
                <span className="font-semibold">{selectedPlan?.name}</span>.
              </p>

              {previewData && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Amount charged:</span>{" "}
                  <span className="font-bold text-primary">
                    {(previewData.immediateCharge / 100).toFixed(2)} {previewData.currency}
                  </span>
                </p>
              )}

              <p className="text-xs text-muted-foreground pt-2 border-t">
                The change has taken effect immediately. You can now continue to the app.
              </p>
            </div>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                setShowSuccessDialog(false);
                window.location.href = '/';
              }}
            >
              Continue to App
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Error Dialog - Shows when upgrade fails */}
      <Dialog open={!!errorMessage} onOpenChange={() => {
        setErrorMessage(null);
        setShowConfirmDialog(false);
        setSelectedPlan(null);
        setPreviewData(null);
        setPreviewError(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600 dark:text-red-400">
              Upgrade Request Failed
            </DialogTitle>
            <div className="space-y-3 pt-2 text-muted-foreground">
              <p className="text-sm text-muted-foreground">
                {errorMessage}
              </p>
              <p className="text-xs text-muted-foreground border-t pt-2">
                Please try again or contact support if the problem persists.
              </p>
            </div>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setErrorMessage(null);
                setShowConfirmDialog(false);
                setSelectedPlan(null);
                setPreviewData(null);
                setPreviewError(null);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Uncancel Confirmation Dialog */}
      <Dialog open={showUncancelDialog} onOpenChange={(open) => {
        setShowUncancelDialog(open);
        if (!open) {
          setPendingPlanAfterUncancel(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reactivate Subscription</DialogTitle>
            <div className="space-y-3 pt-2 text-muted-foreground">
              <p className="text-sm">
                Your subscription is scheduled to cancel on{" "}
                <span className="font-semibold">{subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : 'N/A'}</span>.
              </p>
              {pendingPlanAfterUncancel ? (
                <p className="text-sm">
                  To upgrade to <span className="font-semibold">{pendingPlanAfterUncancel.name}</span>, you need to reactivate your subscription first. Would you like to continue?
                </p>
              ) : (
                <p className="text-sm">
                  Are you sure you want to reactivate your subscription? It will continue to renew automatically.
                </p>
              )}
            </div>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowUncancelDialog(false);
                setPendingPlanAfterUncancel(null);
              }}
              disabled={uncancelSubscriptionMutation.isPending}
            >
              {pendingPlanAfterUncancel ? "Cancel" : "Keep Cancelled"}
            </Button>
            <Button
              onClick={() => uncancelSubscriptionMutation.mutate()}
              disabled={uncancelSubscriptionMutation.isPending}
              autoFocus
            >
              {uncancelSubscriptionMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Reactivating...
                </>
              ) : (
                pendingPlanAfterUncancel ? "Reactivate & Continue" : "Yes, Reactivate"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
