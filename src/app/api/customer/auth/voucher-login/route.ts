import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { nanoid } from 'nanoid';

export async function POST(request: NextRequest) {
  try {
    const { voucherCode, customerName, customerPhone } = await request.json();

    if (!voucherCode) {
      return NextResponse.json(
        { success: false, error: 'Voucher code is required' },
        { status: 400 }
      );
    }

    // Find voucher by code
    const voucher = await prisma.hotspotVoucher.findUnique({
      where: { code: voucherCode.toUpperCase() },
      include: {
        profile: {
          select: {
            name: true,
            sellingPrice: true,
            validityValue: true,
            validityUnit: true,
            speed: true,
          },
        },
      },
    });

    if (!voucher) {
      return NextResponse.json(
        { success: false, error: 'Invalid voucher code' },
        { status: 404 }
      );
    }

    // Check voucher status
    if (voucher.status === 'EXPIRED') {
      return NextResponse.json(
        { success: false, error: 'Voucher has expired' },
        { status: 400 }
      );
    }

    if (voucher.status === 'ACTIVE' && voucher.lastUsedBy) {
      return NextResponse.json(
        { success: false, error: 'Voucher has already been used' },
        { status: 400 }
      );
    }

    // Check if voucher is expired
    if (voucher.expiresAt && new Date() > voucher.expiresAt) {
      await prisma.hotspotVoucher.update({
        where: { id: voucher.id },
        data: { status: 'EXPIRED' },
      });
      
      return NextResponse.json(
        { success: false, error: 'Voucher has expired' },
        { status: 400 }
      );
    }

    // Create customer session
    const token = nanoid(64);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for voucher sessions

    const customerSession = await prisma.customerSession.create({
      data: {
        userId: `voucher_${voucher.id}`,
        phone: customerPhone || '0000000000',
        token,
        expiresAt,
        verified: true,
        otpCode: null,
        otpExpiry: null,
      },
    });

    // Update voucher status and usage info
    const updatedVoucher = await prisma.hotspotVoucher.update({
      where: { id: voucher.id },
      data: {
        status: 'ACTIVE',
        firstLoginAt: new Date(),
        lastUsedBy: customerName || 'Anonymous',
      },
    });

    // Prepare user data for response
    const user = {
      id: `voucher_${voucher.id}`,
      username: voucher.code,
      name: customerName || 'Voucher User',
      phone: customerPhone || 'N/A',
      email: null,
      status: 'active',
      expiredAt: voucher.expiresAt,
      profile: voucher.profile,
      voucherInfo: {
        code: voucher.code,
        profileName: voucher.profile.name,
        validityValue: voucher.profile.validityValue,
        validityUnit: voucher.profile.validityUnit,
        speed: voucher.profile.speed,
      },
    };

    return NextResponse.json({
      success: true,
      requireOTP: false,
      user,
      token,
      voucher: updatedVoucher,
    });

  } catch (error: unknown) {
    console.error('Voucher login error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
