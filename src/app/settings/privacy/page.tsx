"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePrivacySettingsValue, useUpdatePrivacySettings } from "@/hooks/use-privacy-settings";
import { SUPPORT_EMAIL } from "@/lib/branding-constants";
import { ExternalLink, FileText, ShieldCheck } from "lucide-react";

export default function PrivacySettingsPage() {
  const settings = usePrivacySettingsValue();
  const { mutate: updateSettings, isPending: isSaving } = useUpdatePrivacySettings();

  const handleCheckboxChange = (field: keyof typeof settings, checked: boolean) => {
    updateSettings({ ...settings, [field]: checked });
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Privacy Settings</h1>
        {isSaving && <span className="text-sm text-gray-500">Saving...</span>}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Data Sharing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="share-anonymous">Share anonymous data with partners</Label>
                <p className="text-sm text-muted-foreground">Help our partners improve their services with anonymous data</p>
              </div>
              <Switch
                id="share-anonymous"
                checked={settings.shareAnonymousData}
                onCheckedChange={(checked) => handleCheckboxChange('shareAnonymousData', Boolean(checked))}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="share-diagnostics">Share diagnostic data</Label>
                <p className="text-sm text-muted-foreground">Share technical data to help improve app performance</p>
              </div>
              <Switch
                id="share-diagnostics"
                checked={settings.shareDiagnostics}
                onCheckedChange={(checked) => handleCheckboxChange('shareDiagnostics', Boolean(checked))}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Legal</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <a
              href="https://www.oearol.com/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-accent/50"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Privacy Policy</span>
                  <span className="block text-xs text-muted-foreground">How your data is handled</span>
                </span>
              </span>
              <ExternalLink className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
            </a>

            <a
              href="https://www.oearol.com/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-accent/50"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <FileText className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Terms of Service</span>
                  <span className="block text-xs text-muted-foreground">The terms for using Lumy</span>
                </span>
              </span>
              <ExternalLink className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted-foreground">
              If you want to request a copy of your Lumy data or have any privacy or data related query, contact support at{" "}
              <a
                className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
                href={`mailto:${SUPPORT_EMAIL}`}
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
