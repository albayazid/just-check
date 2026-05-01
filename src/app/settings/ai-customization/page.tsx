"use client";

import Link from 'next/link';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAICustomizationSettingsValue, useUpdateAICustomizationSettings } from "@/hooks/use-ai-customization-settings";

export default function AICustomizationSettingsPage() {
  const settings = useAICustomizationSettingsValue();
  const { mutate: updateSettings, isPending: isSaving } = useUpdateAICustomizationSettings();

  const [pendingField, setPendingField] = useState<{ field: string, value: string | boolean } | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleChange = useCallback((field: string, value: string | boolean) => {
    setPendingField({ field, value });

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {
      updateSettings({ ...settings, [field]: value });
      setPendingField(null);
    }, 500);
  }, [settings, updateSettings]);

  const getValue = (field: string) => {
    if (pendingField?.field === field) {
      return String(pendingField.value);
    }
    return String(settings[field as keyof typeof settings] || '');
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">AI Customization</h1>
        {isSaving && <span className="text-sm text-gray-500">Saving...</span>}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Your AI&apos;s Personality</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="ai-nickname">AI Nickname</Label>
              <Input
                id="ai-nickname"
                placeholder="What you want to call the AI"
                value={getValue('aiNickname')}
                onChange={(e) => handleChange('aiNickname', e.target.value)}
              />
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <div className="space-y-2 flex-1">
                <Label htmlFor="ai-tone">AI Tone</Label>
                <Select
                  value={getValue('aiTone')}
                  onValueChange={(value) => handleChange('aiTone', value)}
                >
                  <SelectTrigger id="ai-tone" className="w-full">
                    <SelectValue placeholder="Select AI tone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="warmer">Warmer</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="gen-z">Gen-Z</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 flex-1">
                <Label htmlFor="response-length">Response Length</Label>
                <Select
                  value={getValue('responseLength')}
                  onValueChange={(value) => handleChange('responseLength', value)}
                >
                  <SelectTrigger id="response-length" className="w-full">
                    <SelectValue placeholder="Select response length" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="concise">Concise</SelectItem>
                    <SelectItem value="detail">Detailed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-instructions">Custom Instructions</Label>
              <Textarea
                id="custom-instructions"
                placeholder="Add any specific instructions or preferences for how the AI should behave..."
                className="min-h-[120px]"
                value={getValue('customInstructions')}
                onChange={(e) => handleChange('customInstructions', e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>About You</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="user-nickname">Your Nickname</Label>
              <Input
                id="user-nickname"
                placeholder="What AI will call you"
                value={getValue('userNickname')}
                onChange={(e) => handleChange('userNickname', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-profession">Your Profession</Label>
              <Input
                id="user-profession"
                placeholder="e.g., Software Engineer, Doctor, Student"
                value={getValue('userProfession')}
                onChange={(e) => handleChange('userProfession', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="preferred-topics">Preferred Topics</Label>
              <Textarea
                id="preferred-topics"
                placeholder="List topics you're most interested in (e.g., technology, science, business)"
                className="min-h-20"
                value={getValue('preferredTopics')}
                onChange={(e) => handleChange('preferredTopics', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="avoid-topics">Topics to Avoid</Label>
              <Textarea
                id="avoid-topics"
                placeholder="List topics you prefer to avoid"
                className="min-h-20"
                value={getValue('avoidTopics')}
                onChange={(e) => handleChange('avoidTopics', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="more-about-you">More About You</Label>
              <Textarea
                id="more-about-you"
                placeholder="Tell us more about yourself, your interests, hobbies, or anything else you'd like to share..."
                className="min-h-[120px]"
                value={getValue('moreAboutYou')}
                onChange={(e) => handleChange('moreAboutYou', e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Memory
            </CardTitle>
            <CardDescription>
              Control whether Lumy can use and update long-term memory during chats.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-background/70 p-4">
              <div className="space-y-1">
                <Label htmlFor="memory-enabled" className="text-sm font-medium">
                  Use memory in chat
                </Label>
                <p className="text-sm text-muted-foreground">
                  When off, Lumy will not receive saved memory in context and cannot update memory from conversations.
                </p>
              </div>
              <Switch
                id="memory-enabled"
                checked={settings.memoryEnabled}
                onCheckedChange={(checked) => handleChange('memoryEnabled', checked)}
                disabled={isSaving}
              />
            </div>

            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Review, edit, or clean up long-term memory outside chat whenever you want.
              </p>
              {settings.memoryEnabled ? (
                <Link href="/settings/ai-customization/memory">
                  <Button variant="outline">
                    Manage Memory
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </Link>
              ) : (
                <Button variant="outline" disabled>
                  Manage Memory
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
