import React from 'react';
import { cn } from '../../utils/cn';

export const Card = ({ children, className, ...props }) => {
    return (
        <div
            className={cn("bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden", className)}
            {...props}
        >
            {children}
        </div>
    );
};

export const CardHeader = ({ children, className }) => (
    <div className={cn("px-6 py-4 border-b border-gray-100", className)}>
        {children}
    </div>
);

export const CardTitle = ({ children, className }) => (
    <h3 className={cn("text-lg font-semibold text-gray-900", className)}>
        {children}
    </h3>
);

export const CardContent = ({ children, className }) => (
    <div className={cn("p-6", className)}>
        {children}
    </div>
);
