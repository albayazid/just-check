"use client";

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useId,
  useLayoutEffect,
  ReactNode,
  ReactElement,
  HTMLAttributes,
  cloneElement,
  forwardRef,
  Ref,
  CSSProperties,
  ComponentPropsWithoutRef,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// --- Helper Hook for Merging Refs (Unchanged) ---
function useMergeRefs<T>(...refs: Array<Ref<T> | undefined>): Ref<T> {
  return useMemo(() => {
    if (refs.every((ref) => ref == null)) return null;
    return (node: T) => {
      refs.forEach((ref) => {
        if (!ref) return;
        if (typeof ref === "function") ref(node);
        else (ref as { current: T | null }).current = node;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, refs);
}

// --- Context for dropdown state (Unchanged) ---
interface DropdownContextProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  align?: "left" | "center" | "right";
  triggerId: string;
  surfaceId: string;
  wasOpenedByClickRef: { current: boolean };
}

const DropdownContext = createContext<DropdownContextProps | null>(null);

const useDropdown = () => {
  const context = useContext(DropdownContext);
  if (!context) {
    throw new Error("Dropdown components must be used within a <Dropdown> provider");
  }
  return context;
};

// --- Main Dropdown Container (Unchanged) ---
interface DropdownProps {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "left" | "center" | "right";
  className?: string;
}

export function Dropdown({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  align = "left",
  className,
  ...props
}: DropdownProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const wasClosedByKeyboardRef = useRef(false);
  const wasOpenedByClickRef = useRef(false);

  const id = useId();
  const triggerId = `dropdown-trigger-${id}`;
  const surfaceId = `dropdown-surface-${id}`;

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (isControlled) {
        onOpenChange?.(nextOpen);
      } else {
        setUncontrolledOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }
    },
    [isControlled, onOpenChange]
  );

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        surfaceRef.current && !surfaceRef.current.contains(event.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(event.target as Node)
      ) {
        wasClosedByKeyboardRef.current = false;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        wasClosedByKeyboardRef.current = true;
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);
  
  useEffect(() => {
    if (!open && wasClosedByKeyboardRef.current) {
        triggerRef.current?.focus();
        wasClosedByKeyboardRef.current = false;
    }
  }, [open]);

  const contextValue = useMemo(
    () => ({ open, setOpen, triggerRef, surfaceRef, align, triggerId, surfaceId, wasOpenedByClickRef }),
    [open, setOpen, align, triggerId, surfaceId]
  );

  return (
    <DropdownContext.Provider value={contextValue}>
      <div {...props} className={cn("inline-block", className)}>
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

// --- Dropdown Trigger (Unchanged) ---
interface DropdownTriggerProps extends ComponentPropsWithoutRef<"button"> {
  children: ReactNode;
  asChild?: boolean;
}

export const DropdownTrigger = forwardRef<HTMLElement, DropdownTriggerProps>(
  ({ children, asChild = false, className, onClick, ...props }, forwardedRef) => {
    const { open, setOpen, triggerRef, triggerId, surfaceId, wasOpenedByClickRef } = useDropdown();
    const mergedRef = useMergeRefs(forwardedRef, triggerRef);

    const commonProps = {
      id: triggerId,
      "data-state": open ? "open" : "closed",
      "aria-expanded": open,
      "aria-haspopup": "menu" as const, 
      "aria-controls": open ? surfaceId : undefined,
    };
    
    const handleClick = (e: React.MouseEvent<HTMLElement>) => {
      (onClick as React.MouseEventHandler<HTMLElement>)?.(e);
        // e.detail is 0 for keyboard activation, non-zero for mouse click
        wasOpenedByClickRef.current = e.detail !== 0;
        setOpen(!open);
    };

    if (asChild) {
      if (!React.isValidElement(children)) return null;
      const child = children as React.ReactElement<any>;
      return cloneElement(child, {
        ...props,
        ...commonProps,
        ref: mergedRef,
        onClick: (e: React.MouseEvent<HTMLElement>) => {
            child.props.onClick?.(e);
            handleClick(e);
        },
        className: cn(child.props.className, className),
      });
    }

    return (
      <button
        type="button"
        ref={mergedRef as Ref<HTMLButtonElement>}
        {...props}
        {...commonProps}
        onClick={handleClick}
        className={cn(className)}
      >
        {children}
      </button>
    );
  }
);
DropdownTrigger.displayName = "DropdownTrigger";

// --- Dropdown Surface (POSITIONING LOGIC FIXED) ---
interface DropdownSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  align?: "left" | "center" | "right";
  sideOffset?: number;
  collisionPadding?: number;
  onMouseLeave?: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export const DropdownSurface = forwardRef<HTMLDivElement, DropdownSurfaceProps>(
  ({ children, className, align: propAlign, sideOffset = 8, collisionPadding = 10, onMouseLeave, ...props }, forwardedRef) => {
    const { open, surfaceRef, triggerRef, align: contextAlign, surfaceId, triggerId, wasOpenedByClickRef } = useDropdown();
    const align = propAlign || contextAlign;
    const mergedRef = useMergeRefs(forwardedRef, surfaceRef);

    useLayoutEffect(() => {
      const surfaceNode = surfaceRef.current;
      const triggerNode = triggerRef.current;

      if (!open || !surfaceNode || !triggerNode) return;

      surfaceNode.style.opacity = '0';

      const updatePosition = () => {
        const triggerRect = triggerNode.getBoundingClientRect();
        const surfaceRect = surfaceNode.getBoundingClientRect();
        const vpHeight = window.innerHeight;
        const vpWidth = window.innerWidth;

        let newStyle: CSSProperties = { position: 'fixed' };

        // Vertical position
        const spaceBelow = vpHeight - triggerRect.bottom;
        const spaceAbove = triggerRect.top;
        if (spaceBelow >= surfaceRect.height || spaceBelow >= spaceAbove) {
          newStyle.top = `${triggerRect.bottom + sideOffset}px`;
        } else {
          newStyle.top = `${triggerRect.top - surfaceRect.height - sideOffset}px`;
        }

        // Horizontal position
        let leftPos = 0;
        if (align === "center") leftPos = triggerRect.left + triggerRect.width / 2 - surfaceRect.width / 2;
        else if (align === "right") leftPos = triggerRect.right - surfaceRect.width;
        else leftPos = triggerRect.left;

        // Horizontal collision
        if (leftPos + surfaceRect.width > vpWidth - collisionPadding) {
            newStyle.left = 'auto';
            newStyle.right = `${collisionPadding}px`;
        } else if (leftPos < collisionPadding) {
            newStyle.left = `${collisionPadding}px`;
        } else {
            newStyle.left = `${leftPos}px`;
        }

        Object.assign(surfaceNode.style, newStyle);
        surfaceNode.style.opacity = '1';
        surfaceNode.style.transform = 'scale(1)';
      };

      const frameId = requestAnimationFrame(updatePosition);

      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);

      return () => {
        cancelAnimationFrame(frameId);
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };

    }, [open, sideOffset, align, collisionPadding, triggerRef, surfaceRef]);
    
    // Auto focus on open
    useEffect(() => {
      const surface = surfaceRef.current;
      if (!open || !surface) return;

      const focusTimeout = setTimeout(() => {
        if (wasOpenedByClickRef.current) {
          // If opened by click, focus the surface itself to capture key events
          // without highlighting a specific item.
          surface.focus({ preventScroll: true });
        } else {
          // If opened by keyboard, focus the first item for accessibility.
          const items = Array.from(
            surface.querySelectorAll<HTMLElement>('[role="menuitem"]')
          );
          if (items.length > 0) {
            items[0].focus();
          }
        }
      }, 0);

      return () => clearTimeout(focusTimeout);
    }, [open, surfaceRef, wasOpenedByClickRef]);
    
    // Keyboard Navigation
    useEffect(() => {
        const surface = surfaceRef.current;
        if (!open || !surface) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const items = Array.from(surface.querySelectorAll<HTMLElement>('[role="menuitem"]'));
            if (items.length === 0) return;
            const activeIndex = items.findIndex(item => item === document.activeElement);
            let nextIndex = -1;
            switch(e.key) {
              case 'ArrowDown':
                e.preventDefault();
                nextIndex = activeIndex >= items.length - 1 ? 0 : activeIndex + 1;
                break;
              case 'ArrowUp':
                e.preventDefault();
                nextIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
                break;
              case 'Home':
                e.preventDefault();
                nextIndex = 0;
                break;
              case 'End':
                e.preventDefault();
                nextIndex = items.length - 1;
                break;
              case 'Tab':
                e.preventDefault();
                if (e.shiftKey) {
                  // Shift + Tab on first item wraps to last item
                  nextIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
                } else {
                  // Tab on last item wraps to first item
                  nextIndex = activeIndex >= items.length - 1 ? 0 : activeIndex + 1;
                }
                break;
            }
            if (nextIndex !== -1) items[nextIndex]?.focus();
        };
        surface.addEventListener('keydown', handleKeyDown);
        return () => {
            surface.removeEventListener('keydown', handleKeyDown);
        }
    }, [open, surfaceRef]);

    const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
        onMouseLeave?.(e);
        // When the mouse leaves the surface, focus the surface itself.
        // This keeps the dropdown ready for keyboard navigation without
        // leaving a specific item visually highlighted.
        surfaceRef.current?.focus({ preventScroll: true });
    };

    if (!open || typeof window === "undefined") {
      return null;
    }

    return createPortal(
      <div
        ref={mergedRef}
        id={surfaceId}
        role="menu"
        tabIndex={-1}
        aria-labelledby={triggerId}
        aria-orientation="vertical"
        data-state={open ? "open" : "closed"}
        className={cn(
          "fixed z-50 min-w-40 overflow-hidden rounded-xl border bg-popover/95 shadow-2xl backdrop-blur-lg text-popover-foreground",
          "transition-opacity duration-150 transform-gpu", // using transform-gpu for better perf
          "scale-[0.95] opacity-0", // Start hidden, will be overridden by JS
          "focus:outline-none", // Hide the focus ring on the container
          className
        )}
        {...props}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>,
      document.body
    );
  }
);
DropdownSurface.displayName = "DropdownSurface";


// --- Dropdown Item (Unchanged) ---
interface DropdownItemProps extends ComponentPropsWithoutRef<"button"> {
  icon?: ReactElement<HTMLAttributes<HTMLElement>>;
  onSelect?: (event: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => void;
  onMouseEnter?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  closeOnSelect?: boolean;
}

export const DropdownItem = forwardRef<HTMLButtonElement, DropdownItemProps>(
  (
    { children, icon, onSelect, closeOnSelect = true, className, onMouseEnter, ...props },
    ref
  ) => {
    const { setOpen } = useDropdown();

    const handleSelect = (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect?.(e);
      props.onClick?.(e as React.MouseEvent<HTMLButtonElement>);
      if (closeOnSelect) setOpen(false);
    };

    const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
      onMouseEnter?.(e);
      // Focus the element on hover to allow keyboard navigation to start from this item.
      e.currentTarget.focus();
    };

    return (
      <button
        ref={ref}
        role="menuitem"
        type="button"
        tabIndex={-1}
        className={cn(
          "flex w-full items-center space-x-2 px-3 py-2 text-left text-sm outline-none transition-colors",
          "focus:bg-accent hover:bg-accent",
          "disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        onClick={handleSelect}
        onMouseEnter={handleMouseEnter}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelect(e);
          }
          props.onKeyDown?.(e);
        }}
        {...props}
      >
        {icon && cloneElement(icon, { className: cn("h-4 w-4", icon.props.className) })}
        <span>{children}</span>
      </button>
    );
  }
);
DropdownItem.displayName = "DropdownItem";




















// # Comprehensive Dropdown Component Documentation

// ## Overview
// The Dropdown component is a highly customizable, accessible, and flexible dropdown menu system built with React and TypeScript. It features automatic positioning, keyboard navigation, accessibility compliance, and supports complex content structures.

// ### Key Features:
// - 🧩 Compound component architecture
// - ♿️ Full accessibility compliance (WAI-ARIA)
// - 🎯 Smart positioning with collision detection
// - ⌨️ Comprehensive keyboard navigation
// - 🎨 Customizable styling with class merging
// - 🚀 Controlled and uncontrolled state management
// - ✨ Smooth animations and transitions

// ## Component Structure

// ### 1. Dropdown (Root Component)
// Manages the dropdown state and context

// ```tsx
// <Dropdown 
//   open={boolean} 
//   defaultOpen={boolean}
//   onOpenChange={(open: boolean) => void}
//   align="left | center | right"
//   className="string"
// >
//   {/* Child components */}
// </Dropdown>
// ```

// ### 2. DropdownTrigger
// The element that toggles the dropdown

// ```tsx
// <DropdownTrigger 
//   asChild={boolean} 
//   className="string"
// >
//   {/* Child element or component */}
// </DropdownTrigger>
// ```

// ### 3. DropdownSurface
// The container that appears when dropdown is open

// ```tsx
// <DropdownSurface 
//   align="left | center | right"
//   sideOffset={number}
//   collisionPadding={number}
//   className="string"
// >
//   {/* Dropdown content */}
// </DropdownSurface>
// ```

// ### 4. DropdownItem
// Pre-styled interactive menu item

// ```tsx
// <DropdownItem 
//   icon={ReactElement}
//   onSelect={() => void}
//   closeOnSelect={boolean}
//   className="string"
//   disabled={boolean}
// >
//   {/* Item content */}
// </DropdownItem>
// ```

// ## Heavy Usage Example

// ```tsx
// import { 
//   Dropdown, 
//   DropdownTrigger, 
//   DropdownSurface, 
//   DropdownItem 
// } from "@/components/ui/dropdown";
// import { 
//   User, 
//   Settings, 
//   LogOut, 
//   CreditCard, 
//   HelpCircle,
//   Bell,
//   Mail,
//   Lock,
//   Star,
//   Plus,
//   ChevronRight
// } from "lucide-react";
// import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import { Separator } from "@/components/ui/separator";
// import { Switch } from "@/components/ui/switch";
// import { Input } from "@/components/ui/input";

// export function UserProfileDropdown() {
//   return (
//     <Dropdown defaultOpen={false} align="right">
//       <DropdownTrigger asChild>
//         <Button variant="ghost" className="p-0 rounded-full h-10 w-10">
//           <Avatar>
//             <AvatarImage src="/path/to/avatar.jpg" alt="User Avatar" />
//             <AvatarFallback>JD</AvatarFallback>
//           </Avatar>
//         </Button>
//       </DropdownTrigger>

//       <DropdownSurface 
//         className="w-80 bg-gradient-to-b from-neutral-900/95 to-neutral-800/95"
//         sideOffset={12}
//         collisionPadding={16}
//       >
//         {/* Custom Header */}
//         <div className="flex items-center gap-3 p-4 pb-3">
//           <Avatar className="h-12 w-12">
//             <AvatarImage src="/path/to/avatar.jpg" alt="User Avatar" />
//             <AvatarFallback className="bg-blue-600 text-white">JD</AvatarFallback>
//           </Avatar>
//           <div className="flex-1 min-w-0">
//             <p className="font-semibold text-white truncate">John Doe</p>
//             <p className="text-xs text-neutral-400 truncate">john.doe@example.com</p>
//             <Badge 
//               variant="solid" 
//               className="mt-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
//             >
//               Pro Plan
//             </Badge>
//           </div>
//         </div>

//         <Separator className="my-2 bg-neutral-700/50" />

//         {/* Notification Item with Badge */}
//         <DropdownItem 
//           icon={<Bell className="h-4 w-4 text-amber-400" />}
//           onSelect={() => console.log('Notifications clicked')}
//           className="group"
//         >
//           <div className="flex items-center justify-between w-full">
//             <span>Notifications</span>
//             <Badge 
//               variant="solid" 
//               className="bg-red-500/20 text-red-400 group-hover:bg-red-500/30 transition-colors"
//             >
//               3 new
//             </Badge>
//           </div>
//         </DropdownItem>

//         {/* Email Verification Status */}
//         <DropdownItem 
//           icon={<Mail className="h-4 w-4 text-blue-400" />}
//           onSelect={() => console.log('Email verification clicked')}
//           className="bg-blue-900/10 hover:bg-blue-900/20"
//         >
//           <div className="flex items-center justify-between w-full">
//             <span>Verify Email</span>
//             <Badge variant="outline" className="border-blue-500/30 text-blue-400">
//               Pending
//             </Badge>
//           </div>
//         </DropdownItem>

//         <Separator className="my-2 bg-neutral-700/50" />

//         {/* Account Section */}
//         <div className="px-3 py-1.5 text-xs font-medium text-neutral-400 uppercase tracking-wider">
//           Account
//         </div>
//         <DropdownItem icon={<User className="h-4 w-4" />}>
//           Profile
//         </DropdownItem>
//         <DropdownItem icon={<CreditCard className="h-4 w-4" />}>
//           Billing
//         </DropdownItem>
//         <DropdownItem icon={<Settings className="h-4 w-4" />}>
//           Settings
//         </DropdownItem>
//         <DropdownItem 
//           icon={<Lock className="h-4 w-4" />} 
//           closeOnSelect={false}
//         >
//           <div className="flex items-center justify-between w-full">
//             <span>Two-factor Auth</span>
//             <Switch className="scale-75" />
//           </div>
//         </DropdownItem>

//         <Separator className="my-2 bg-neutral-700/50" />

//         {/* Teams Section */}
//         <div className="px-3 py-1.5 text-xs font-medium text-neutral-400 uppercase tracking-wider">
//           Teams
//         </div>
//         <DropdownItem icon={<Star className="h-4 w-4 text-amber-400 fill-amber-400/20" />}>
//           <div className="flex items-center justify-between w-full">
//             <span>Design Team</span>
//             <Badge variant="outline">Primary</Badge>
//           </div>
//         </DropdownItem>
//         <DropdownItem icon={<Star className="h-4 w-4" />}>
//           Marketing Team
//         </DropdownItem>
//         <DropdownItem 
//           icon={<Plus className="h-4 w-4 text-green-400" />}
//           className="text-green-400 hover:bg-green-900/10"
//         >
//           Create New Team
//         </DropdownItem>

//         <Separator className="my-2 bg-neutral-700/50" />

//         {/* Custom Search Section */}
//         <div className="p-3">
//           <div className="text-sm font-medium text-neutral-200 mb-2">
//             Quick Search
//           </div>
//           <Input 
//             placeholder="Search commands..." 
//             className="bg-neutral-800 border-neutral-700 focus:border-blue-500"
//           />
//           <div className="grid grid-cols-2 gap-2 mt-3">
//             <Button variant="outline" size="sm" className="text-xs">
//               Docs
//             </Button>
//             <Button variant="outline" size="sm" className="text-xs">
//               Settings
//             </Button>
//             <Button variant="outline" size="sm" className="text-xs">
//               Members
//             </Button>
//             <Button variant="outline" size="sm" className="text-xs">
//               Billing
//             </Button>
//           </div>
//         </div>

//         <Separator className="my-2 bg-neutral-700/50" />

//         {/* Custom Footer */}
//         <div className="p-3 text-xs text-neutral-400 flex justify-between items-center">
//           <div>
//             <div>Last login: Today, 10:30 AM</div>
//             <div className="flex items-center gap-1 mt-1">
//               <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
//               <span>All systems operational</span>
//             </div>
//           </div>
//           <Badge variant="outline">v2.4.1</Badge>
//         </div>

//         <Separator className="my-2 bg-neutral-700/50" />

//         {/* Logout with Submenu */}
//         <div className="relative group">
//           <DropdownItem 
//             icon={<LogOut className="h-4 w-4" />} 
//             className="text-red-400 hover:bg-red-500/10 group-hover:bg-red-500/10"
//           >
//             <div className="flex items-center justify-between w-full">
//               <span>Log out</span>
//               <ChevronRight className="h-4 w-4" />
//             </div>
//           </DropdownItem>
          
//           {/* Nested Submenu */}
//           <div className="absolute top-0 left-full ml-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
//             <div className="bg-neutral-800/95 backdrop-blur-lg border border-neutral-700/50 rounded-lg shadow-xl w-48 overflow-hidden">
//               <button className="w-full text-left px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700/50">
//                 Log out from this device
//               </button>
//               <button className="w-full text-left px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700/50">
//                 Log out from all devices
//               </button>
//             </div>
//           </div>
//         </div>
//       </DropdownSurface>
//     </Dropdown>
//   );
// }
// ```

// ## Key Features Demonstrated

// ### 1. Complex Content Structure
// - Custom headers with user information
// - Multiple sections with separators
// - Mixed interactive and non-interactive content
// - Badges and status indicators
// - Input fields and switches
// - Nested hover submenus

// ### 2. Varied Dropdown Items
// - Items with badges and status indicators
// - Items with toggle switches (`closeOnSelect={false}`)
// - Custom styled items (e.g., verification status with special background)
// - Disabled state handling
// - Items with icons of varying colors

// ### 3. Advanced Styling
// - Gradient backgrounds
// - Custom border styling
// - Hover states with different colors
// - Animated transitions
// - Proper spacing and typography hierarchy

// ### 4. Smart Positioning
// - `align="right"` prop for right-aligned dropdowns
// - `sideOffset={12}` for fine-tuning vertical position
// - `collisionPadding={16}` to prevent viewport collisions
// - Automatic above/below positioning based on available space

// ### 5. Accessibility Features
// - Proper ARIA attributes (`aria-expanded`, `role="menu"`, etc.)
// - Keyboard navigation (arrows, home/end, enter/space)
// - Focus management (returns focus to trigger after close)
// - Screen reader friendly markup

// ### 6. Interaction Patterns
// - Hover-triggered submenus
// - Toggle switches within dropdown items
// - Search input with quick actions
// - Status indicators with color coding

// ## Best Practices

// ### 1. Positioning
// ```tsx
// <DropdownSurface 
//   align="right"
//   sideOffset={8} 
//   collisionPadding={16}
// >
//   {/* Content */}
// </DropdownSurface>
// ```
// - Use `align` to control horizontal alignment
// - Adjust `sideOffset` for spacing between trigger and surface
// - Set `collisionPadding` to prevent clipping at viewport edges

// ### 2. Custom Content
// ```tsx
// <DropdownSurface>
//   {/* Non-interactive header */}
//   <div className="p-3 border-b border-neutral-700">
//     <h3 className="font-semibold">Custom Section</h3>
//   </div>
  
//   {/* Interactive items */}
//   <DropdownItem>Action 1</DropdownItem>
//   <DropdownItem>Action 2</DropdownItem>
  
//   {/* Custom interactive element */}
//   <button 
//     className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-700/50"
//     onClick={() => console.log('Custom action')}
//   >
//     Custom Button
//   </button>
// </DropdownSurface>
// ```
// - Mix `DropdownItem` with custom elements as needed
// - Use standard HTML elements for non-standard interactions
// - Maintain consistent styling with the existing components

// ### 3. Keyboard Navigation
// - ↑/↓: Navigate between items
// - Enter/Space: Activate current item
// - Esc: Close dropdown
// - Home/End: Jump to first/last item

// ### 4. State Management
// ```tsx
// const [isOpen, setIsOpen] = useState(false);

// return (
//   <Dropdown open={isOpen} onOpenChange={setIsOpen}>
//     {/* ... */}
//   </Dropdown>
// );
// ```
// - Use `open` and `onOpenChange` for controlled state
// - Use `defaultOpen` for uncontrolled components
// - Combine with external state as needed

// ### 5. Styling Customization
// ```tsx
// <DropdownItem 
//   className="text-red-400 hover:bg-red-500/10 focus:bg-red-500/10"
// >
//   Delete Item
// </DropdownItem>
// ```
// - Use `className` prop to override styles
// - Maintain accessibility contrast ratios
// - Use Tailwind's `cn` utility for conditional classes

// ## Accessibility Considerations

// ### Required ARIA Attributes
// - **DropdownTrigger**: 
//   - `aria-expanded`
//   - `aria-haspopup="menu"`
//   - `aria-controls` (pointing to surface ID)
// - **DropdownSurface**:
//   - `role="menu"`
//   - `aria-labelledby` (pointing to trigger ID)
// - **DropdownItem**:
//   - `role="menuitem"`

// ### Keyboard Interaction
// | Key          | Action                       |
// |--------------|------------------------------|
// | ↓            | Next item                    |
// | ↑            | Previous item                |
// | Home         | First item                   |
// | End          | Last item                    |
// | Enter/Space  | Activate current item        |
// | Esc          | Close dropdown               |
// | Tab          | Move focus (within dropdown) |

// ### Focus Management
// - When opened, focus moves to first menu item
// - When closed, focus returns to trigger
// - Focus trapped within dropdown while open

// ## Performance Optimization

// ### 1. Memoization
// ```tsx
// const contextValue = useMemo(() => ({
//   open, setOpen, triggerRef, surfaceRef, align
// }), [open, setOpen, align]);
// ```

// ### 2. Efficient Positioning
// - Position calculations only when open
// - Debounced resize/scroll handlers
// - CSS transforms instead of layout-thrushing properties

// ### 3. Conditional Rendering
// ```tsx
// if (!open) return null;
// ```
// - Surface only renders when open
// - Event listeners only attached when needed

// ## Troubleshooting

// ### Common Issues

// 1. **Positioning incorrect**:
//    - Check `align` and `sideOffset` props
//    - Verify parent elements don't have `overflow: hidden`
//    - Increase `collisionPadding` if clipped

// 2. **Keyboard navigation not working**:
//    - Ensure all focusable elements have proper `role`
//    - Verify no parent element is intercepting key events
//    - Check for proper focus management

// 3. **Accessibility warnings**:
//    - Verify all ARIA attributes are present
//    - Ensure `aria-controls`/`aria-labelledby` IDs match
//    - Check color contrast ratios

// 4. **Custom content not interactive**:
//    - Ensure custom elements are focusable (`tabIndex`)
//    - Add proper keyboard event handlers
//    - Use `role="menuitem"` for custom items

// ## Conclusion

// This dropdown component provides a robust foundation for creating accessible, customizable dropdown menus in React applications. With its compound component structure, it offers maximum flexibility while handling complex positioning, keyboard navigation, and accessibility requirements out of the box.

// The heavy example demonstrates how to build a comprehensive user profile dropdown with various content types, interactive elements, and nested submenus. By following the patterns and best practices outlined, you can create dropdown experiences that are both visually appealing and functionally robust.
