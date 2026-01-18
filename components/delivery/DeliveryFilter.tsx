'use client';

import { useState } from 'react';
import { Search, Filter, X, Calendar, User, CheckCircle } from 'lucide-react';
import './DeliveryFilter.css';

interface DeliveryFilterProps {
    onFilterChange?: (filters: DeliveryFilters) => void;
}

export interface DeliveryFilters {
    search: string;
    status: string;
    dateFrom: string;
    dateTo: string;
    clientName: string;
}

export function DeliveryFilter({ onFilterChange }: DeliveryFilterProps) {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<string>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [clientName, setClientName] = useState('');
    const [isExpanded, setIsExpanded] = useState(false);

    const handleFilterChange = (updates: Partial<DeliveryFilters>) => {
        const newFilters: DeliveryFilters = {
            search,
            status,
            dateFrom,
            dateTo,
            clientName,
            ...updates
        };
        
        if (updates.search !== undefined) setSearch(updates.search);
        if (updates.status !== undefined) setStatus(updates.status);
        if (updates.dateFrom !== undefined) setDateFrom(updates.dateFrom);
        if (updates.dateTo !== undefined) setDateTo(updates.dateTo);
        if (updates.clientName !== undefined) setClientName(updates.clientName);

        onFilterChange?.(newFilters);
    };

    const hasActiveFilters = status !== 'all' || dateFrom || dateTo || clientName || search;

    const clearFilters = () => {
        setSearch('');
        setStatus('all');
        setDateFrom('');
        setDateTo('');
        setClientName('');
        onFilterChange?.({
            search: '',
            status: 'all',
            dateFrom: '',
            dateTo: '',
            clientName: ''
        });
    };

    return (
        <div className="delivery-filter-container">
            <div className="delivery-filter-main">
                <div className="delivery-search-box">
                    <Search size={18} className="delivery-search-icon" />
                    <input
                        type="text"
                        className="delivery-filter-input"
                        placeholder="Search by order # or client..."
                        value={search}
                        onChange={(e) => handleFilterChange({ search: e.target.value })}
                        style={{ paddingLeft: '2.5rem' }}
                    />
                </div>

                <button
                    className={`delivery-filter-toggle ${hasActiveFilters ? 'active' : ''}`}
                    onClick={() => setIsExpanded(!isExpanded)}
                    title={isExpanded ? 'Hide filters' : 'Show filters'}
                >
                    <Filter size={18} />
                    {hasActiveFilters && <span className="filter-badge"></span>}
                </button>
            </div>

            {isExpanded && (
                <div className="delivery-filter-expanded">
                    <div className="delivery-filter-row">
                        <div className="delivery-filter-group">
                            <label className="delivery-filter-label">
                                <User size={16} />
                                Client Name
                            </label>
                            <input
                                type="text"
                                className="delivery-filter-input"
                                placeholder="Filter by client name..."
                                value={clientName}
                                onChange={(e) => handleFilterChange({ clientName: e.target.value })}
                            />
                        </div>

                        <div className="delivery-filter-group">
                            <label className="delivery-filter-label">
                                <CheckCircle size={16} />
                                Status
                            </label>
                            <select
                                className="delivery-filter-select"
                                value={status}
                                onChange={(e) => handleFilterChange({ status: e.target.value })}
                            >
                                <option value="all">All Statuses</option>
                                <option value="pending">Pending</option>
                                <option value="confirmed">Confirmed</option>
                                <option value="waiting_for_proof">Waiting for Proof</option>
                                <option value="billing_pending">Billing Pending</option>
                                <option value="delivered">Delivered</option>
                                <option value="cancelled">Cancelled</option>
                            </select>
                        </div>
                    </div>

                    <div className="delivery-filter-row">
                        <div className="delivery-filter-group">
                            <label className="delivery-filter-label">
                                <Calendar size={16} />
                                Date From
                            </label>
                            <input
                                type="date"
                                className="delivery-filter-input"
                                value={dateFrom}
                                onChange={(e) => handleFilterChange({ dateFrom: e.target.value })}
                            />
                        </div>

                        <div className="delivery-filter-group">
                            <label className="delivery-filter-label">
                                <Calendar size={16} />
                                Date To
                            </label>
                            <input
                                type="date"
                                className="delivery-filter-input"
                                value={dateTo}
                                onChange={(e) => handleFilterChange({ dateTo: e.target.value })}
                            />
                        </div>
                    </div>

                    {hasActiveFilters && (
                        <div className="delivery-filter-actions">
                            <button
                                className="delivery-filter-clear"
                                onClick={clearFilters}
                            >
                                <X size={16} />
                                Clear All Filters
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
