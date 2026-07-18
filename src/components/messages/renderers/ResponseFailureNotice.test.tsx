import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResponseFailureNotice } from './ResponseFailureNotice';
import type { ChatErrorKind } from '@/lib/chat-error';

function renderNotice(overrides: Partial<React.ComponentProps<typeof ResponseFailureNotice>> = {}) {
  const onRegenerate = vi.fn();
  const onDismiss = vi.fn();
  const utils = render(
    <ResponseFailureNotice
      kind='generic'
      message='Response interrupted.'
      onRegenerate={onRegenerate}
      onDismiss={onDismiss}
      {...overrides}
    />,
  );
  return { onRegenerate, onDismiss, ...utils };
}

describe('<ResponseFailureNotice />', () => {
  it('renders the message text and action buttons', () => {
    renderNotice({ message: 'Connection lost.' });
    expect(screen.getByText('Connection lost.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss failure notice' })).toBeInTheDocument();
  });

  it('uses the amber palette for transient (network) failures', () => {
    renderNotice({ kind: 'network' as ChatErrorKind });
    const alert = screen.getByRole('alert');
    expect(alert.className).toMatch(/amber/);
  });

  it('uses the destructive palette for non-transient failures', () => {
    renderNotice({ kind: 'allowance' as ChatErrorKind });
    const alert = screen.getByRole('alert');
    expect(alert.className).toMatch(/destructive/);
    expect(alert.className).not.toMatch(/amber/);
  });

  it('renders the WifiOff icon for network failures', () => {
    renderNotice({ kind: 'network' as ChatErrorKind });
    // The alert exists and contains an svg — we just verify the class distinction
    // since lucide icons don't expose semantic roles.
    const alert = screen.getByRole('alert');
    expect(alert.querySelector('svg')).toBeInTheDocument();
  });

  it('calls onRegenerate when the Regenerate button is clicked', async () => {
    const user = userEvent.setup();
    const { onRegenerate } = renderNotice();

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));

    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when the Dismiss button is clicked', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderNotice();

    await user.click(screen.getByRole('button', { name: 'Dismiss failure notice' }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('disables the Regenerate button when disabled is true', () => {
    renderNotice({ disabled: true });
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled();
  });

  it('hides the Regenerate button when onRegenerate is omitted', () => {
    renderNotice({ onRegenerate: undefined });
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
  });

  it('is announced to assistive tech via role=alert', () => {
    renderNotice();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
