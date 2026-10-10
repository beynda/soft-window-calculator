<?php

declare(strict_types=1);

namespace BeyndaCalculator\Mail;

interface MailTransport
{
    public function send(MailMessage $message): void;
}

